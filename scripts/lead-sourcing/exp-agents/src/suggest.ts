import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openCountryPage, sleepWithJitter, waitForHuman } from './browser.ts';
import {
  appendJsonl,
  loadSuggestionsCheckpoint,
  saveSuggestionsCheckpoint,
} from './checkpoint.ts';
import { harvestNameSuggestions } from './graphql.ts';
import { AdaptiveHealthGate } from './health.ts';
import { defaultTwoLetterPrefixes, enqueueAfterPrefix } from './prefixes.ts';
import type { CountryCode, SuggestionsCheckpoint } from './types.ts';

export type SuggestPhaseResult = {
  suggestions: string[];
  prefixesCompleted: number;
  gqlCalls: number;
};

function suggestionsJsonlPath(runDir: string, country: CountryCode): string {
  return join(runDir, `suggestions_${country.toLowerCase()}.jsonl`);
}

function loadSuggestionNames(runDir: string, country: CountryCode): Set<string> {
  const path = suggestionsJsonlPath(runDir, country);
  const names = new Set<string>();
  if (!existsSync(path)) return names;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { name?: string };
      if (row.name) names.add(row.name);
    } catch {
      // skip bad lines
    }
  }
  return names;
}

function loadPrefixesWithHits(runDir: string, country: CountryCode): Set<string> {
  const path = suggestionsJsonlPath(runDir, country);
  const prefixes = new Set<string>();
  if (!existsSync(path)) return prefixes;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { prefix?: string };
      if (row.prefix) prefixes.add(row.prefix.toLowerCase());
    } catch {
      // skip bad lines
    }
  }
  return prefixes;
}

/** Empty API response is suspicious when we already know matching names. */
function knownNamesForPrefix(prefix: string, names: Iterable<string>): string[] {
  const p = prefix.toLowerCase();
  const out: string[] = [];
  for (const name of names) {
    if (name.toLowerCase().startsWith(p)) out.push(name);
  }
  return out;
}

/**
 * Re-queue completed prefixes that returned [] while known names start with them
 * (classic captcha/rate-limit false empty).
 */
function repairFalseEmptyPrefixes(
  state: {
    queue: string[];
    completedPrefixes: string[];
    verifiedPrefixes?: string[];
    done: boolean;
  },
  countryNames: Set<string>,
  prefixesWithHits: Set<string>,
): number {
  const completed = new Set(state.completedPrefixes);
  const verified = new Set(
    (state.verifiedPrefixes ?? []).map((p) => p.toLowerCase()),
  );
  const requeue: string[] = [];
  for (const prefix of state.completedPrefixes) {
    const known = knownNamesForPrefix(prefix, countryNames);
    if (!known.length) continue;
    // Already verified non-empty, or wrote hits under this exact prefix.
    if (verified.has(prefix.toLowerCase()) || prefixesWithHits.has(prefix.toLowerCase())) {
      continue;
    }
    requeue.push(prefix);
    completed.delete(prefix);
  }
  if (!requeue.length) return 0;
  const queueSet = new Set(state.queue);
  state.queue = [...requeue.filter((p) => !queueSet.has(p)), ...state.queue];
  state.completedPrefixes = [...completed];
  state.done = false;
  return requeue.length;
}

function isBrowserClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /has been closed|Target closed|Browser closed/i.test(message);
}

/**
 * Prefer shorter seeds first (breadth-first), then within the same length
 * prefer prefixes that already match known names.
 */
function prioritizeQueueByKnownNames(queue: string[], names: Set<string>): string[] {
  const scored = queue.map((prefix, index) => {
    const known = knownNamesForPrefix(prefix, names).length;
    return { prefix, known, index, len: prefix.length };
  });
  scored.sort((a, b) => a.len - b.len || b.known - a.known || a.index - b.index);
  return scored.map((s) => s.prefix);
}

async function harvestWithEmptyRetry(
  page: Page,
  prefix: string,
  country: CountryCode,
  countryNames: Set<string>,
  rateMs: number,
  healthProbe: (page: Page) => Promise<void>,
): Promise<{ suggestions: string[]; calls: number; refreshed: boolean }> {
  let calls = 0;
  let refreshed = false;
  let suggestions = await harvestNameSuggestions(page, prefix, country);
  calls += 1;
  let confirmedWhileHealthy = false;

  if (suggestions.length === 0) {
    await healthProbe(page);
    confirmedWhileHealthy = true;
    await sleepWithJitter(Math.max(rateMs, 800));
    suggestions = await harvestNameSuggestions(page, prefix, country);
    calls += 1;
  }

  // Two-letter seeds are high-value; one confirm on empty catches early captcha stress.
  // Deeper empties are only retried when we already know matching names exist.
  const known = knownNamesForPrefix(prefix, countryNames);
  const shouldConfirmEmpty =
    !confirmedWhileHealthy &&
    suggestions.length === 0 &&
    (prefix.length <= 2 || known.length > 0);

  if (shouldConfirmEmpty) {
    await sleepWithJitter(Math.max(rateMs, 800));
    if (known.length > 0) {
      await openCountryPage(page, country);
      refreshed = true;
    }
    suggestions = await harvestNameSuggestions(page, prefix, country);
    calls += 1;
  }

  if (suggestions.length === 0 && known.length > 0) {
    await openCountryPage(page, country);
    refreshed = true;
    suggestions = await harvestNameSuggestions(page, prefix, country);
    calls += 1;
    if (suggestions.length === 0) {
      throw new Error(
        `suspicious empty for prefix=${prefix} (known matching names exist)`,
      );
    }
  }

  return { suggestions, calls, refreshed };
}

function emptyCountryState(seedPrefixes: string[]) {
  return {
    done: false,
    queue: [...seedPrefixes],
    completedPrefixes: [] as string[],
    verifiedPrefixes: [] as string[],
    verifiedEmptyPrefixes: [] as string[],
    suggestionCount: 0,
  };
}

export async function runSuggestPhase(options: {
  page: Page;
  runDir: string;
  countries: CountryCode[];
  seedPrefixes: string[] | null;
  maxSuggestions: number | null;
  rateMs: number;
  resume: boolean;
  waitHuman?: boolean;
  healthGate?: AdaptiveHealthGate;
}): Promise<SuggestPhaseResult> {
  const { page, runDir, countries, maxSuggestions, rateMs, resume } = options;
  const waitHuman = options.waitHuman ?? false;
  const healthGate = options.healthGate ?? new AdaptiveHealthGate();
  const seed = options.seedPrefixes?.length
    ? options.seedPrefixes
    : defaultTwoLetterPrefixes();

  let checkpoint: SuggestionsCheckpoint =
    resume && loadSuggestionsCheckpoint(runDir)
      ? loadSuggestionsCheckpoint(runDir)!
      : { done: false, countries: {} };

  let gqlCalls = 0;
  const allNames = new Set<string>();

  for (const country of countries) {
    if (!checkpoint.countries[country]) {
      checkpoint.countries[country] = emptyCountryState(seed);
    }
    const state = checkpoint.countries[country]!;
    for (const name of loadSuggestionNames(runDir, country)) allNames.add(name);

    if (state.done) {
      console.log(
        `[suggest] ${country} already done (${state.suggestionCount} names, ${state.completedPrefixes.length} prefixes)`,
      );
      continue;
    }

    const countryNames = loadSuggestionNames(runDir, country);
    const repaired = repairFalseEmptyPrefixes(
      state,
      countryNames,
      loadPrefixesWithHits(runDir, country),
    );
    if (repaired > 0) {
      console.log(`[suggest] ${country} re-queued ${repaired} false-empty prefixes`);
      saveSuggestionsCheckpoint(runDir, checkpoint);
    }

    await openCountryPage(page, country);
    const completed = new Set(state.completedPrefixes);
    let queue = state.queue.filter((p) => !completed.has(p));
    let callsSinceRefresh = 0;
    let consecutiveFailures = 0;
    let rateLimitCycles = 0;
    const failedPrefixes: string[] = [];
    const attemptCounts = new Map<string, number>();

    // Prefer deepen children that match letters already seen in known names.
    queue = prioritizeQueueByKnownNames(queue, countryNames);

    console.log(
      `[suggest] ${country} queue=${queue.length} existingNames=${countryNames.size} max=${maxSuggestions ?? 'all'}`,
    );

    while (queue.length > 0) {
      if (maxSuggestions != null && countryNames.size >= maxSuggestions) {
        console.log(`[suggest] ${country} hit max-suggestions=${maxSuggestions}`);
        break;
      }

      if (consecutiveFailures >= 3) {
        rateLimitCycles += 1;
        if (waitHuman) {
          await waitForHuman(
            `Soft-ban / captcha score look bad after ${consecutiveFailures} failures (cycle=${rateLimitCycles}). Use the Chrome window normally for ~30s (type a name, scroll), then continue.`,
          );
          await openCountryPage(page, country);
          callsSinceRefresh = 0;
          consecutiveFailures = 0;
        } else {
          state.queue = queue;
          saveSuggestionsCheckpoint(runDir, checkpoint);
          await healthGate.trip(
            new Error(`suggestion failures=${consecutiveFailures}`),
            {
              country,
              location: `prefix:${queue[0] ?? 'unknown'}`,
              from: 0,
            },
          );
        }
      }

      if (callsSinceRefresh >= 15) {
        console.log(`[suggest] ${country} refreshing page after ${callsSinceRefresh} calls`);
        await openCountryPage(page, country);
        callsSinceRefresh = 0;
      }

      const prefix = queue[0];
      queue = queue.slice(1);

      const verifiedSet = new Set(
        (state.verifiedPrefixes ?? []).map((p) => p.toLowerCase()),
      );
      if (verifiedSet.has(prefix.toLowerCase())) {
        completed.add(prefix);
        state.completedPrefixes = [...completed];
        state.queue = queue;
        saveSuggestionsCheckpoint(runDir, checkpoint);
        console.log(`[suggest] ${country} prefix=${prefix} skip-verified`);
        continue;
      }

      let suggestions: string[] = [];
      try {
        const harvested = await harvestWithEmptyRetry(
          page,
          prefix,
          country,
          countryNames,
          rateMs,
          (probePage) => healthGate.assertHealthy(probePage),
        );
        suggestions = harvested.suggestions;
        gqlCalls += harvested.calls;
        if (harvested.refreshed) callsSinceRefresh = 0;
        else callsSinceRefresh += harvested.calls;
      } catch (error) {
        if (isBrowserClosedError(error)) {
          if (!queue.includes(prefix)) queue.unshift(prefix);
          state.queue = queue;
          saveSuggestionsCheckpoint(runDir, checkpoint);
          throw error;
        }
        // Do not immediate-retry timeouts — that deepens rate-limit holes.
        console.warn(`[suggest] ${country} prefix=${prefix} failed: ${String(error).split('\n')[0]}`);
        const attempts = (attemptCounts.get(prefix) ?? 0) + 1;
        attemptCounts.set(prefix, attempts);
        if (!queue.includes(prefix)) queue.push(prefix);
        if (attempts >= 4 && !failedPrefixes.includes(prefix)) failedPrefixes.push(prefix);
        state.queue = queue;
        saveSuggestionsCheckpoint(runDir, checkpoint);
        consecutiveFailures += 1;
        await sleepWithJitter(Math.max(rateMs * 2, 5000));
        continue;
      }

      consecutiveFailures = 0;
      healthGate.recordDataSuccess();
      completed.add(prefix);
      const verified = new Set(state.verifiedPrefixes ?? []);
      const verifiedEmpty = new Set(state.verifiedEmptyPrefixes ?? []);
      if (suggestions.length > 0) verified.add(prefix);
      else verifiedEmpty.add(prefix);
      state.verifiedPrefixes = [...verified];
      state.verifiedEmptyPrefixes = [...verifiedEmpty];

      let added = 0;
      for (const name of suggestions) {
        if (maxSuggestions != null && countryNames.size >= maxSuggestions) break;
        if (countryNames.has(name)) continue;
        countryNames.add(name);
        allNames.add(name);
        appendJsonl(suggestionsJsonlPath(runDir, country), {
          country,
          prefix,
          name,
          at: new Date().toISOString(),
        });
        added += 1;
      }

      queue = enqueueAfterPrefix({
        prefix,
        suggestionCount: suggestions.length,
        queue,
        completed,
        names: suggestions,
      });

      state.completedPrefixes = [...completed];
      state.queue = queue;
      state.suggestionCount = countryNames.size;
      saveSuggestionsCheckpoint(runDir, checkpoint);

      console.log(
        `[suggest] ${country} prefix=${prefix} got=${suggestions.length} added=${added} totalNames=${countryNames.size} queue=${queue.length}`,
      );

      // Cap hits are followed by a burst of deepen children — refresh first.
      if (suggestions.length >= 65) {
        await openCountryPage(page, country);
        callsSinceRefresh = 0;
        await sleepWithJitter(Math.max(rateMs, 1500));
      } else {
        // Empty prefixes are common after deepen-on-cap; don't burn full rate budget.
        await sleepWithJitter(suggestions.length === 0 ? Math.min(300, rateMs) : rateMs);
      }
    }

    // One more pass over transient failures.
    if (failedPrefixes.length && (maxSuggestions == null || countryNames.size < maxSuggestions)) {
      console.log(`[suggest] ${country} retrying ${failedPrefixes.length} failed prefixes`);
      await openCountryPage(page, country);
      for (const prefix of failedPrefixes) {
        if (completed.has(prefix)) continue;
        try {
          const harvested = await harvestWithEmptyRetry(
            page,
            prefix,
            country,
            countryNames,
            rateMs,
            (probePage) => healthGate.assertHealthy(probePage),
          );
          const suggestions = harvested.suggestions;
          gqlCalls += harvested.calls;
          healthGate.recordDataSuccess();
          completed.add(prefix);
          const verified = new Set(state.verifiedPrefixes ?? []);
          const verifiedEmpty = new Set(state.verifiedEmptyPrefixes ?? []);
          if (suggestions.length > 0) verified.add(prefix);
          else verifiedEmpty.add(prefix);
          state.verifiedPrefixes = [...verified];
          state.verifiedEmptyPrefixes = [...verifiedEmpty];
          for (const name of suggestions) {
            if (countryNames.has(name)) continue;
            countryNames.add(name);
            allNames.add(name);
            appendJsonl(suggestionsJsonlPath(runDir, country), {
              country,
              prefix,
              name,
              at: new Date().toISOString(),
            });
          }
          queue = enqueueAfterPrefix({
            prefix,
            suggestionCount: suggestions.length,
            queue,
            completed,
            names: suggestions,
          });
          console.log(
            `[suggest] ${country} retry prefix=${prefix} got=${suggestions.length} totalNames=${countryNames.size}`,
          );
        } catch (error) {
          console.warn(`[suggest] ${country} final fail prefix=${prefix}: ${String(error)}`);
          queue.push(prefix);
        }
        await sleepWithJitter(rateMs);
      }
      state.completedPrefixes = [...completed];
      state.queue = queue.filter((p) => !completed.has(p));
      state.suggestionCount = countryNames.size;
      saveSuggestionsCheckpoint(runDir, checkpoint);
    }

    const pending = queue.filter((p) => !completed.has(p));
    state.done =
      pending.length === 0 || (maxSuggestions != null && countryNames.size >= maxSuggestions);
    state.queue = pending;
    state.suggestionCount = countryNames.size;
    saveSuggestionsCheckpoint(runDir, checkpoint);
    console.log(`[suggest] ${country} pass complete done=${state.done} names=${state.suggestionCount} pending=${pending.length}`);
  }

  checkpoint.done = countries.every((c) => checkpoint.countries[c]?.done);
  saveSuggestionsCheckpoint(runDir, checkpoint);

  // Rebuild unified list for this run's countries
  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const country of countries) {
    for (const name of loadSuggestionNames(runDir, country)) {
      if (seen.has(name)) continue;
      seen.add(name);
      suggestions.push(name);
    }
  }

  return {
    suggestions,
    prefixesCompleted: countries.reduce(
      (n, c) => n + (checkpoint.countries[c]?.completedPrefixes.length ?? 0),
      0,
    ),
    gqlCalls,
  };
}

export function listSuggestionNamesForCountry(runDir: string, country: CountryCode): string[] {
  return [...loadSuggestionNames(runDir, country)].sort((a, b) => a.localeCompare(b));
}
