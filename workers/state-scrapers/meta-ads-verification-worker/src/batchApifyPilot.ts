import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CANARY_DOMAIN,
  DEFAULT_CANARY_EVERY,
  DEFAULT_COMPANY_DELAY_MS,
  DEFAULT_EMPTY_STREAK_LIMIT,
  DEFAULT_HEALTH_BACKOFF_MS,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  isEmptyNoResultRow,
  rollingYesPct,
} from './apifyBatchHealth.js';
import { acquireApifyBatchLock } from './apifyBatchEnv.js';
import {
  actorIdForKind,
  createApifyClient,
  matchCountToTarget,
  MetaRateLimitError,
  runCountForUrls,
  runFullPullForUrls,
  type ApifyActorKind,
} from './apifyMetaAdsClient.js';
import {
  buildSearchTarget,
  filterAdsForSourceUrl,
  mapApifyRecords,
  resolveApifyCompanyLookup,
} from './apifyMetaAdsMap.js';
import {
  apifyCheckpointArgsMatch,
  createEmptyApifyCheckpoint,
  loadApifyCheckpoint,
  markApifyCheckpointCompleted,
  recordApifyCheckpointError,
  saveApifyCheckpoint,
  unmarkApifyCheckpointDomains,
  type ApifyBatchCheckpoint,
  type ApifyBatchMode,
} from './metaAdLibraryApifyCheckpoint.js';
import {
  loadAllEligibleRows,
  loadPilotRows,
  resolveStage3Csv,
  type CsvRow,
} from './pilotBatchRows.js';
import { META_ADS_WEBINAR_SCAN_DAYS_DEFAULT } from './metaAdLibraryWebinarScan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PILOT_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch-pilot-150-apify';
const DEFAULT_FULL_OUT_DIR = '../../../../tmp/meta-ads-webinar-batch-full-apify';
const DEFAULT_MAX_RESULTS = 25;

const FLAGS_WITH_VALUE = new Set([
  '--out-dir',
  '--checkpoint',
  '--max-rows',
  '--webinar-days',
  '--actor',
  '--screen-actor',
  '--wave-size',
  '--canary-domain',
  '--canary-every',
  '--empty-streak',
  '--health-backoff-ms',
  '--delay-ms',
  '--rate-limit-backoff-ms',
  '--rate-limit-max-retries',
]);

/** Cap for the hybrid screen pull — existence check only. */
const SCREEN_MAX_RESULTS = 1;

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function positionalArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function parseActorFlag(value: string | null): ApifyActorKind {
  if (value === 'official') return 'official';
  return 'leadsbrary';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function pickBatchRows(
  batchMode: ApifyBatchMode,
  maxRows: number | null,
  csvPath: string,
): CsvRow[] {
  if (batchMode === 'all') {
    const rows = loadAllEligibleRows(csvPath);
    if (maxRows != null && maxRows > 0) return rows.slice(0, maxRows);
    return rows;
  }
  return loadPilotRows(maxRows ?? 150, csvPath);
}

function formatBatchResult(
  row: CsvRow,
  lookup: ReturnType<typeof resolveApifyCompanyLookup>,
  actor: ApifyActorKind,
  providerHealth: 'ok' | 'suspect_empty',
  screenActor: ApifyActorKind | null = null,
): Record<string, unknown> {
  const webinarScan = lookup.webinar_scan;
  return {
    company_name: row.company_name.trim(),
    company_domain: row.company_domain.trim(),
    employee_count: row.employee_count,
    industry: row.industry,
    post_count: row.post_count,
    meta_ads_result: lookup.result,
    matched_page_name: lookup.matched_page_name,
    matched_via: lookup.matched_via,
    matched_ad_count: lookup.matched_ad_count,
    matched_ads: lookup.matched_ads,
    top_ad: lookup.top_ad,
    top_ad_primary_text: lookup.top_ad?.primary_text ?? null,
    top_ad_landing_url: lookup.top_ad?.landing_url ?? null,
    webinar_scan_enabled: true,
    webinar_ad_count: webinarScan.webinar_ad_count,
    webinar_ads: webinarScan.webinar_ads,
    recent_ad_count: webinarScan.recent_ad_count,
    scanned_card_count: webinarScan.scanned_card_count,
    initial_card_count: webinarScan.pagination.initial_card_count,
    cards_added_by_scroll: webinarScan.pagination.cards_added_by_scroll,
    scroll_helped: webinarScan.pagination.scroll_helped,
    scroll_attempts: webinarScan.pagination.scroll_attempts,
    scroll_stopped_reason: webinarScan.pagination.stopped_reason,
    search_attempts: lookup.search_attempts,
    provider: 'apify',
    apify_actor: actorIdForKind(actor),
    screen_actor: screenActor ? actorIdForKind(screenActor) : null,
    apify_total_count: lookup.apify_total_count,
    classification_reason: lookup.classification_reason,
    provider_health: providerHealth,
    error: null,
  };
}

/**
 * Cheap existence check via a different actor (typically official).
 * Caps at 1 result; domain search then name fallback. Avoids pointing leadsbrary
 * at empty companies (which triggers Meta #613 page-ID enrichment).
 */
async function screenHasAds(
  client: ReturnType<typeof createApifyClient>,
  screenActor: ApifyActorKind,
  domain: string,
  companyName: string,
): Promise<boolean> {
  const domainTarget = buildSearchTarget(domain, domain, 'domain');
  process.stderr.write(
    `[apify-batch] screen (${screenActor}) ${domain} domain...\n`,
  );
  const { items: domainItems } = await runFullPullForUrls(
    client,
    screenActor,
    [domainTarget.url],
    SCREEN_MAX_RESULTS,
  );
  const domainAds = filterAdsForSourceUrl(mapApifyRecords(domainItems), domainTarget.url);
  if (domainAds.length > 0) return true;

  if (!companyName) return false;

  const nameTarget = buildSearchTarget(domain, companyName, 'name');
  process.stderr.write(
    `[apify-batch] screen (${screenActor}) ${domain} name...\n`,
  );
  const { items: nameItems } = await runFullPullForUrls(
    client,
    screenActor,
    [nameTarget.url],
    SCREEN_MAX_RESULTS,
  );
  const nameAds = filterAdsForSourceUrl(mapApifyRecords(nameItems), nameTarget.url);
  return nameAds.length > 0;
}

async function lookupCompany(
  client: ReturnType<typeof createApifyClient>,
  row: CsvRow,
  actor: ApifyActorKind,
  webinarScanDays: number,
  providerHealth: 'ok' | 'suspect_empty',
  screenActor: ApifyActorKind | null = null,
): Promise<Record<string, unknown>> {
  const domain = row.company_domain.trim();
  const companyName = row.company_name.trim();

  // Hybrid: screen with official (or other) actor first. Empties never reach
  // leadsbrary, so Meta #613 page-ID enrichment on 0-result companies is skipped.
  if (screenActor) {
    const hasAds = await screenHasAds(client, screenActor, domain, companyName);
    if (!hasAds) {
      const emptyLookup = resolveApifyCompanyLookup({
        searchDomain: domain,
        companyName,
        domainAds: [],
        domainTotalCount: 0,
        nameAds: [],
        nameTotalCount: 0,
        webinarScanDays,
      });
      return formatBatchResult(row, emptyLookup, actor, providerHealth, screenActor);
    }
  }

  const domainTarget = buildSearchTarget(domain, domain, 'domain');

  // One combined run per target: the full pull returns both the ad rows and the
  // >0 signal, so we no longer need a separate count pass (halves Meta calls).
  const { items: domainItems } = await runFullPullForUrls(
    client,
    actor,
    [domainTarget.url],
    DEFAULT_MAX_RESULTS,
  );
  const domainAds = filterAdsForSourceUrl(mapApifyRecords(domainItems), domainTarget.url);
  const domainCount = domainAds.length;

  // Only fall back to a company-name search when the domain search found nothing.
  let nameAds: ReturnType<typeof mapApifyRecords> = [];
  let nameCount = 0;
  if (companyName && domainCount === 0) {
    const nameTarget = buildSearchTarget(domain, companyName, 'name');
    const { items: nameItems } = await runFullPullForUrls(
      client,
      actor,
      [nameTarget.url],
      DEFAULT_MAX_RESULTS,
    );
    nameAds = filterAdsForSourceUrl(mapApifyRecords(nameItems), nameTarget.url);
    nameCount = nameAds.length;
  }

  const lookup = resolveApifyCompanyLookup({
    searchDomain: domain,
    companyName,
    domainAds,
    domainTotalCount: domainCount,
    nameAds,
    nameTotalCount: nameCount,
    webinarScanDays,
  });

  return formatBatchResult(row, lookup, actor, providerHealth, screenActor);
}

async function runCanary(
  client: ReturnType<typeof createApifyClient>,
  actor: ApifyActorKind,
  canaryDomain: string,
): Promise<{ ok: boolean; totalCount: number }> {
  const target = buildSearchTarget(canaryDomain, canaryDomain, 'domain');
  process.stderr.write(`[apify-batch] canary ${canaryDomain}...\n`);
  try {
    const { counts } = await runCountForUrls(client, actor, [target.url]);
    const totalCount = matchCountToTarget(counts, target)?.totalCount ?? 0;
    const ok = totalCount > 0;
    process.stderr.write(
      `[apify-batch] canary ${canaryDomain}: ${ok ? 'OK' : 'FAIL'} count=${totalCount}\n`,
    );
    return { ok, totalCount };
  } catch (error) {
    if (error instanceof MetaRateLimitError) {
      process.stderr.write(
        `[apify-batch] canary ${canaryDomain}: FAIL (Meta #613 on run ${error.runId})\n`,
      );
      return { ok: false, totalCount: 0 };
    }
    throw error;
  }
}

class HealthHaltError extends Error {
  readonly rolledBack: number;

  constructor(message: string, rolledBack: number) {
    super(message);
    this.name = 'HealthHaltError';
    this.rolledBack = rolledBack;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = positionalArgs(argv);
  const resume = hasFlag(argv, '--resume');
  const fresh = hasFlag(argv, '--fresh');
  const batchAll = hasFlag(argv, '--all');
  const pilot = hasFlag(argv, '--pilot') || (!batchAll && !hasFlag(argv, '--max-rows'));
  const batchMode: ApifyBatchMode = batchAll ? 'all' : 'pilot';
  const actor = parseActorFlag(readFlag(argv, '--actor'));
  const screenActorFlag = readFlag(argv, '--screen-actor');
  const screenActor = screenActorFlag ? parseActorFlag(screenActorFlag) : null;
  const maxRowsFlag = readFlag(argv, '--max-rows');
  const maxRows = maxRowsFlag ? Number(maxRowsFlag) : batchMode === 'pilot' ? 150 : null;
  const webinarScanDays = Number(readFlag(argv, '--webinar-days') ?? META_ADS_WEBINAR_SCAN_DAYS_DEFAULT);
  const waveSizeFlag = readFlag(argv, '--wave-size');
  const waveSize = waveSizeFlag ? Number(waveSizeFlag) : null;
  const canaryDomain = readFlag(argv, '--canary-domain') ?? DEFAULT_CANARY_DOMAIN;
  const canaryEvery = Number(readFlag(argv, '--canary-every') ?? DEFAULT_CANARY_EVERY);
  const emptyStreakLimit = Number(readFlag(argv, '--empty-streak') ?? DEFAULT_EMPTY_STREAK_LIMIT);
  const healthBackoffMs = Number(readFlag(argv, '--health-backoff-ms') ?? DEFAULT_HEALTH_BACKOFF_MS);
  const delayMs = Number(readFlag(argv, '--delay-ms') ?? DEFAULT_COMPANY_DELAY_MS);
  const rateLimitBackoffMs = Number(
    readFlag(argv, '--rate-limit-backoff-ms') ?? DEFAULT_RATE_LIMIT_BACKOFF_MS,
  );
  // After this many in-run #613 backoffs without any successful company, halt so an
  // outer auto-resume loop can take over with a longer cooldown (avoids thrashing).
  const rateLimitMaxRetries = Number(readFlag(argv, '--rate-limit-max-retries') ?? 3);
  const defaultOutDir = batchMode === 'all' ? DEFAULT_FULL_OUT_DIR : DEFAULT_PILOT_OUT_DIR;
  const outDir = resolve(__dirname, readFlag(argv, '--out-dir') ?? defaultOutDir);
  mkdirSync(outDir, { recursive: true });
  const csvPath = resolveStage3Csv(positional[0]);
  const checkpointPath = resolve(outDir, readFlag(argv, '--checkpoint') ?? 'apify-batch-checkpoint.json');
  const outPath = resolve(outDir, 'webinar-batch-results.json');

  const batchRows = pickBatchRows(batchMode, maxRows, csvPath);
  if (batchRows.length === 0) throw new Error('No rows to process');

  const uniqueDomains = new Set(batchRows.map((r) => r.company_domain.trim()));
  // screenActor deliberately omitted from checkpoint args so --resume with
  // --screen-actor official attaches to the existing leadsbrary fingerprint.
  const checkpointArgs = {
    csvPath,
    outDir,
    batchMode,
    maxRows,
    actor,
    webinarScanDays,
  };

  let checkpoint: ApifyBatchCheckpoint;
  if (resume && !fresh) {
    const loaded = loadApifyCheckpoint(checkpointPath);
    if (!loaded) throw new Error(`No checkpoint found at ${checkpointPath}`);
    apifyCheckpointArgsMatch(loaded, checkpointArgs);
    checkpoint = loaded;
    process.stderr.write(
      `Resuming Apify batch (${checkpoint.completedDomains.length}/${uniqueDomains.size} unique domains complete)\n`,
    );
  } else {
    checkpoint = createEmptyApifyCheckpoint(checkpointArgs);
  }

  acquireApifyBatchLock(outDir);
  const client = createApifyClient();
  const completed = new Set(checkpoint.completedDomains);
  const startedAt = Date.now();
  const progressEvery = batchMode === 'all' ? 25 : 10;

  process.stderr.write(
    [
      '[apify-batch] starting',
      `  mode: ${batchMode}${pilot && batchMode === 'pilot' ? ' (pilot sample)' : ''}`,
      `  actor: ${actorIdForKind(actor)}`,
      `  screen_actor: ${screenActor ? actorIdForKind(screenActor) : 'off'}`,
      `  rows: ${batchRows.length} (${uniqueDomains.size} unique domains)`,
      `  wave_size: ${waveSize ?? 'unlimited (run until halt or done)'}`,
      `  delay_ms: ${delayMs}`,
      `  rate_limit_backoff_ms: ${rateLimitBackoffMs} (max ${rateLimitMaxRetries} retries)`,
      `  canary: ${canaryDomain} every ${canaryEvery}`,
      `  empty_streak_limit: ${emptyStreakLimit}`,
      `  out_dir: ${outDir}`,
      `  checkpoint: ${checkpointPath}`,
    ].join('\n') + '\n',
  );

  const startupCanary = await runCanary(client, actor, canaryDomain);
  if (!startupCanary.ok) {
    writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
    console.error(
      `HEALTH_HALT: startup canary ${canaryDomain} failed (count=${startupCanary.totalCount}); resume later with --resume`,
    );
    process.exit(2);
  }

  let lastCanaryAt = Date.now();
  let consecutiveEmpty = 0;
  const emptyStreakDomains: string[] = [];
  let processedThisRun = 0;
  let sinceCanary = 0;
  let consecutiveRateLimitBackoffs = 0;

  try {
    for (const row of batchRows) {
      const domain = row.company_domain.trim();
      const companyName = row.company_name.trim();
      if (completed.has(domain)) {
        continue;
      }

      if (processedThisRun > 0 && delayMs > 0) {
        await sleep(delayMs);
      }

      if (sinceCanary >= canaryEvery && processedThisRun > 0) {
        const canary = await runCanary(client, actor, canaryDomain);
        lastCanaryAt = Date.now();
        sinceCanary = 0;
        if (!canary.ok) {
          const rolledBack = unmarkApifyCheckpointDomains(checkpoint, emptyStreakDomains);
          saveApifyCheckpoint(checkpointPath, checkpoint);
          writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
          throw new HealthHaltError(
            `HEALTH_HALT: periodic canary ${canaryDomain} failed after ${consecutiveEmpty} consecutive empties; rolled back ${rolledBack} domains; resume later with --resume`,
            rolledBack,
          );
        }
      }

      process.stderr.write(`Apify lookup ${companyName} (${domain})...\n`);
      let companyDone = false;
      while (!companyDone) {
      try {
        const providerHealth: 'ok' | 'suspect_empty' =
          consecutiveEmpty >= Math.floor(emptyStreakLimit / 2) ? 'suspect_empty' : 'ok';
        const formatted = await lookupCompany(
          client,
          row,
          actor,
          webinarScanDays,
          providerHealth,
          screenActor,
        );
        markApifyCheckpointCompleted(checkpoint, domain, formatted);
        saveApifyCheckpoint(checkpointPath, checkpoint);
        completed.add(domain);
        processedThisRun += 1;
        sinceCanary += 1;
        companyDone = true;
        consecutiveRateLimitBackoffs = 0;

        if (isEmptyNoResultRow(formatted)) {
          consecutiveEmpty += 1;
          emptyStreakDomains.push(domain);
        } else {
          consecutiveEmpty = 0;
          emptyStreakDomains.length = 0;
        }

        const done = checkpoint.completedDomains.length;
        const remaining = uniqueDomains.size - done;
        const elapsed = Date.now() - startedAt;
        const msPer = processedThisRun > 0 ? Math.round(elapsed / processedThisRun) : 0;
        if (
          processedThisRun === 1 ||
          remaining === 0 ||
          processedThisRun % progressEvery === 0 ||
          consecutiveEmpty === emptyStreakLimit
        ) {
          const stats = summarizeResults(checkpoint.results);
          process.stderr.write(
            [
              `[apify-batch] ${done}/${uniqueDomains.size} (+${processedThisRun} this run, ${remaining} left)`,
              `yes ${stats.yes} | no ${stats.no} | unknown ${stats.unknown} | webinar ${stats.webinar}`,
              `empty_streak ${consecutiveEmpty}/${emptyStreakLimit}`,
              `rolling_yes_50 ${rollingYesPct(checkpoint.results, 50).toFixed(1)}%`,
              `canary_age_s ${Math.round((Date.now() - lastCanaryAt) / 1000)}`,
              `ms/company ${msPer}`,
            ].join(' | ') + '\n',
          );
        }

        if (consecutiveEmpty >= emptyStreakLimit) {
          process.stderr.write(
            `[apify-batch] ${consecutiveEmpty} consecutive empty no_results — backing off ${Math.round(healthBackoffMs / 1000)}s then re-canary\n`,
          );
          await sleep(healthBackoffMs);
          const canary = await runCanary(client, actor, canaryDomain);
          lastCanaryAt = Date.now();
          sinceCanary = 0;
          if (!canary.ok) {
            const rolledBack = unmarkApifyCheckpointDomains(checkpoint, emptyStreakDomains);
            saveApifyCheckpoint(checkpointPath, checkpoint);
            writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
            throw new HealthHaltError(
              `HEALTH_HALT: canary failed after ${consecutiveEmpty} consecutive empties; rolled back ${rolledBack} domains; resume later with --resume`,
              rolledBack,
            );
          }
          consecutiveEmpty = 0;
          emptyStreakDomains.length = 0;
          process.stderr.write('[apify-batch] canary recovered after backoff — continuing\n');
        }

        if (waveSize != null && waveSize > 0 && processedThisRun >= waveSize) {
          process.stderr.write(
            `[apify-batch] wave-size ${waveSize} reached — clean exit (resume later with --resume)\n`,
          );
          writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
          const stats = summarizeResults(checkpoint.results);
          console.log(
            JSON.stringify(
              {
                output: outPath,
                checkpoint: checkpointPath,
                batch_mode: batchMode,
                actor: actorIdForKind(actor),
                total_rows: batchRows.length,
                unique_domains: uniqueDomains.size,
                completed_domains: checkpoint.completedDomains.length,
                processed_this_run: processedThisRun,
                wave_size: waveSize,
                stats,
                elapsed_ms: Date.now() - startedAt,
                errors: checkpoint.errors,
              },
              null,
              2,
            ),
          );
          return;
        }
      } catch (error) {
        if (error instanceof HealthHaltError) throw error;
        if (error instanceof MetaRateLimitError) {
          consecutiveRateLimitBackoffs += 1;
          if (consecutiveRateLimitBackoffs >= rateLimitMaxRetries) {
            const rolledBack = unmarkApifyCheckpointDomains(checkpoint, emptyStreakDomains);
            saveApifyCheckpoint(checkpointPath, checkpoint);
            writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
            throw new HealthHaltError(
              `HEALTH_HALT: Meta #613 persisted through ${consecutiveRateLimitBackoffs} backoffs; rolled back ${rolledBack} domains; resume later with --resume`,
              rolledBack,
            );
          }
          process.stderr.write(
            `[apify-batch] Meta #613 rate limit on ${companyName} (${error.runId}) [${consecutiveRateLimitBackoffs}/${rateLimitMaxRetries}] — backing off ${Math.round(rateLimitBackoffMs / 1000)}s then re-canary\n`,
          );
          await sleep(rateLimitBackoffMs);
          const canary = await runCanary(client, actor, canaryDomain);
          lastCanaryAt = Date.now();
          sinceCanary = 0;
          if (!canary.ok) {
            const rolledBack = unmarkApifyCheckpointDomains(checkpoint, emptyStreakDomains);
            saveApifyCheckpoint(checkpointPath, checkpoint);
            writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
            throw new HealthHaltError(
              `HEALTH_HALT: Meta #613 — canary still failing after ${Math.round(rateLimitBackoffMs / 1000)}s backoff; rolled back ${rolledBack} domains; resume later with --resume`,
              rolledBack,
            );
          }
          process.stderr.write(
            `[apify-batch] canary recovered after Meta #613 backoff — retrying ${companyName}\n`,
          );
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        recordApifyCheckpointError(checkpoint, {
          company_domain: domain,
          company_name: companyName,
          error: message,
        });
        saveApifyCheckpoint(checkpointPath, checkpoint);
        process.stderr.write(`Error on ${companyName}: ${message}\n`);
        consecutiveEmpty = 0;
        emptyStreakDomains.length = 0;
        companyDone = true;
      }
      }
    }
  } catch (error) {
    if (error instanceof HealthHaltError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }

  writeFileSync(outPath, JSON.stringify(checkpoint.results, null, 2));
  const stats = summarizeResults(checkpoint.results);
  console.log(
    JSON.stringify(
      {
        output: outPath,
        checkpoint: checkpointPath,
        batch_mode: batchMode,
        actor: actorIdForKind(actor),
        total_rows: batchRows.length,
        unique_domains: uniqueDomains.size,
        completed_domains: checkpoint.completedDomains.length,
        processed_this_run: processedThisRun,
        wave_size: waveSize,
        stats,
        elapsed_ms: Date.now() - startedAt,
        errors: checkpoint.errors,
      },
      null,
      2,
    ),
  );
}

function summarizeResults(results: Record<string, unknown>[]): {
  yes: number;
  no: number;
  unknown: number;
  webinar: number;
} {
  return {
    yes: results.filter((r) => r.meta_ads_result === 'yes').length,
    no: results.filter((r) => r.meta_ads_result === 'no').length,
    unknown: results.filter((r) => r.meta_ads_result === 'unknown').length,
    webinar: results.filter((r) => ((r.webinar_ad_count as number | undefined) ?? 0) > 0).length,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
