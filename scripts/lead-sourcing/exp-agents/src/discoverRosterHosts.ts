import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeExpBrowser,
  launchExpBrowser,
  sleepWithJitter,
  type LaunchOptions,
} from './browser.ts';
import { loadJson, saveJson } from './checkpoint.ts';
import {
  agentsPhpUrl,
  classifyHostKind,
  emptyHost,
  guessJurisdictions,
  hostPrefix,
  looksLikeChallengeHtml,
  mergeHostManifest,
  normalizeHost,
  parseRosterJson,
  rosterEndpoint,
  seedHosts,
  updateHostStatus,
} from './rosterHosts.ts';
import type { RosterHost, RosterHostManifest } from './rosterTypes.ts';

export type DiscoveryCandidate = {
  host: string;
  prefix: string;
  jurisdictions: string[];
  source: 'seed' | 'discovered';
};

export type DiscoveryReport = {
  generatedAt: string;
  attempted: number;
  healthy: number;
  empty: number;
  challenge: number;
  error: number;
  personalOrTiny: number;
  newHealthyHosts: Array<{ host: string; count: number; jurisdictions: string[] }>;
  plateauReached: boolean;
  notes: string[];
};

/** Extra MLS/regional prefixes beyond the seeded state list. */
export const EXTRA_DISCOVERY_PREFIXES: Array<{ prefix: string; jurisdictions: string[] }> = [
  { prefix: 'wnc', jurisdictions: ['NC'] },
  { prefix: 'vab', jurisdictions: ['VA'] },
  { prefix: 'tca', jurisdictions: ['FL'] },
  { prefix: 'nca', jurisdictions: ['CA'] },
  { prefix: 'sca', jurisdictions: ['CA'] },
  { prefix: 'bbv', jurisdictions: ['CA'] },
  { prefix: 'mia', jurisdictions: ['FL'] },
  { prefix: 'elp', jurisdictions: ['TX'] },
  { prefix: 'sa', jurisdictions: ['TX'] },
  { prefix: 'la', jurisdictions: ['CA'] },
  { prefix: 'sba', jurisdictions: ['CA'] },
  { prefix: 'abor', jurisdictions: ['TX'] },
  { prefix: 'ntreis', jurisdictions: ['TX'] },
];

export function buildDiscoveryCandidates(options?: {
  jurisdictions?: string[];
  includeWww?: boolean;
}): DiscoveryCandidate[] {
  const seeded = seedHosts({
    jurisdictions: options?.jurisdictions,
    includeWww: options?.includeWww ?? true,
  });
  const byHost = new Map<string, DiscoveryCandidate>();
  for (const host of seeded) {
    byHost.set(normalizeHost(host.host), {
      host: normalizeHost(host.host),
      prefix: host.prefix,
      jurisdictions: [...host.jurisdictions],
      source: 'seed',
    });
  }
  for (const entry of EXTRA_DISCOVERY_PREFIXES) {
    if (
      options?.jurisdictions &&
      !entry.jurisdictions.some((j) =>
        options.jurisdictions!.map((x) => x.toUpperCase()).includes(j.toUpperCase()),
      )
    ) {
      continue;
    }
    const host = normalizeHost(`https://${entry.prefix}.exprealty.com`);
    const prior = byHost.get(host);
    if (prior) {
      for (const jurisdiction of entry.jurisdictions) {
        if (!prior.jurisdictions.includes(jurisdiction)) prior.jurisdictions.push(jurisdiction);
      }
      continue;
    }
    byHost.set(host, {
      host,
      prefix: entry.prefix,
      jurisdictions: [...entry.jurisdictions],
      source: 'discovered',
    });
  }
  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host));
}

export function evaluateDiscoveryPlateau(
  recentNewMatchedIds: number[],
  baselineMatchedIds: number,
  windowSize = 20,
  thresholdPct = 1,
): boolean {
  if (recentNewMatchedIds.length < windowSize) return false;
  const window = recentNewMatchedIds.slice(-windowSize);
  const added = window.reduce((sum, value) => sum + value, 0);
  const pct = (added / Math.max(1, baselineMatchedIds)) * 100;
  return pct < thresholdPct;
}

async function probeHost(
  page: Awaited<ReturnType<typeof launchExpBrowser>>['page'],
  host: string,
): Promise<{ status: 'healthy' | 'empty' | 'challenge' | 'error'; count: number; error?: string }> {
  try {
    await page.goto(agentsPhpUrl(host), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
    const endpoint = rosterEndpoint(host, '');
    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, { credentials: 'include' });
        return { status: response.status, body: await response.text() };
      } catch (error) {
        return { status: 0, body: String(error) };
      }
    }, endpoint);
    if (
      result.status >= 400 ||
      result.status === 0 ||
      looksLikeChallengeHtml(result.body)
    ) {
      return {
        status: result.status === 403 || looksLikeChallengeHtml(result.body)
          ? 'challenge'
          : 'error',
        count: 0,
        error: `HTTP ${result.status}`,
      };
    }
    const parsed = parseRosterJson(result.body);
    if (!parsed?.length) return { status: 'empty', count: 0 };
    return { status: 'healthy', count: parsed.length };
  } catch (error) {
    return {
      status: 'error',
      count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function discoverRosterHosts(options: {
  runDir: string;
  jurisdictions?: string[];
  rateMs?: number;
  resume?: boolean;
  headed?: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  maxHosts?: number | null;
}): Promise<{
  manifest: RosterHostManifest;
  report: DiscoveryReport;
}> {
  mkdirSync(options.runDir, { recursive: true });
  const manifestPath = join(options.runDir, 'roster_host_manifest.json');
  const reportPath = join(options.runDir, 'roster_discovery_report.json');
  const checkpointPath = join(options.runDir, 'roster_discovery_checkpoint.json');

  const existing = options.resume ? loadJson<RosterHostManifest>(manifestPath) : null;
  const candidates = buildDiscoveryCandidates({
    jurisdictions: options.jurisdictions,
    includeWww: true,
  });
  const seededHosts = candidates.map((candidate) => ({
    ...emptyHost(candidate.prefix, candidate.jurisdictions),
    host: candidate.host,
    source: candidate.source,
  }));
  let manifest = mergeHostManifest(existing, seededHosts);

  const checkpoint = (options.resume &&
    loadJson<{ probedHosts: string[] }>(checkpointPath)) || { probedHosts: [] };
  const probed = new Set(checkpoint.probedHosts.map(normalizeHost));

  const pending = candidates.filter((candidate) => !probed.has(normalizeHost(candidate.host)));
  const limited =
    options.maxHosts != null ? pending.slice(0, options.maxHosts) : pending;

  const report: DiscoveryReport = {
    generatedAt: new Date().toISOString(),
    attempted: 0,
    healthy: 0,
    empty: 0,
    challenge: 0,
    error: 0,
    personalOrTiny: 0,
    newHealthyHosts: [],
    plateauReached: false,
    notes: [],
  };

  if (!limited.length) {
    report.notes.push('No pending discovery hosts.');
    saveJson(reportPath, report);
    saveJson(manifestPath, manifest);
    return { manifest, report };
  }

  const launch: LaunchOptions = {
    headed: options.headed ?? true,
    cdpUrl: options.cdpUrl,
    userDataDir: options.userDataDir,
  };
  const session = await launchExpBrowser(launch);
  const recentYield: number[] = [];

  try {
    for (const candidate of limited) {
      const host = normalizeHost(candidate.host);
      report.attempted += 1;
      process.stdout.write(`[discover] ${host} ... `);
      const result = await probeHost(session.page, host);
      const prior = manifest.hosts.find((row) => normalizeHost(row.host) === host);
      const base: RosterHost =
        prior ??
        ({
          ...emptyHost(candidate.prefix, candidate.jurisdictions),
          host,
          source: candidate.source,
        } satisfies RosterHost);

      if (result.status === 'healthy') {
        report.healthy += 1;
        const kind = classifyHostKind(result.count, candidate.prefix);
        if (kind === 'personal' || result.count <= 1) report.personalOrTiny += 1;
        const wasNew = !prior || prior.status !== 'healthy';
        manifest = mergeHostManifest(manifest, [
          updateHostStatus(base, {
            status: 'healthy',
            rosterCount: result.count,
            agentsPhpOk: true,
            kind,
            error: null,
            jurisdictions: candidate.jurisdictions.length
              ? candidate.jurisdictions
              : guessJurisdictions(hostPrefix(host)),
          }),
        ]);
        if (wasNew && result.count > 1) {
          report.newHealthyHosts.push({
            host,
            count: result.count,
            jurisdictions: candidate.jurisdictions,
          });
          recentYield.push(result.count);
        } else {
          recentYield.push(0);
        }
        console.log(`OK ${result.count}`);
      } else {
        report[result.status] += 1;
        manifest = mergeHostManifest(manifest, [
          updateHostStatus(base, {
            status: result.status,
            agentsPhpOk: false,
            rosterCount: 0,
            error: result.error ?? result.status,
          }),
        ]);
        recentYield.push(0);
        console.log(result.status);
      }

      probed.add(host);
      saveJson(checkpointPath, {
        probedHosts: [...probed],
        updatedAt: new Date().toISOString(),
      });
      saveJson(manifestPath, manifest);

      if (
        evaluateDiscoveryPlateau(
          recentYield,
          Math.max(1, report.newHealthyHosts.reduce((sum, row) => sum + row.count, 0)),
        )
      ) {
        report.plateauReached = true;
        report.notes.push(
          'Yield plateau reached: last 20 probes added <1% net new roster agents.',
        );
        break;
      }
      await sleepWithJitter(options.rateMs ?? 700);
    }
  } finally {
    await closeExpBrowser(session);
  }

  // Also absorb any already-captured hosts if this runDir points at captures.
  const captureDir = join(options.runDir, 'roster_captures');
  if (existsSync(captureDir)) {
    report.notes.push(`Capture directory present: ${captureDir}`);
  }

  saveJson(reportPath, report);
  saveJson(manifestPath, manifest);
  return { manifest, report };
}
