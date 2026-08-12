import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadJson, saveJson } from './checkpoint.ts';
import { readCsv, writeCsv } from './csv.ts';
import {
  applyManifestUpdates,
  collectRosters,
  loadAllCaptures,
} from './collectRosters.ts';
import {
  buildReviewSample,
  mergeAndClassify,
  writeManagerOutputs,
} from './mergeManagers.ts';
import type { MasterAgent } from './rosterMatch.ts';
import {
  guessJurisdictions,
  hostPrefix,
  hostsForJurisdictions,
  mergeHostManifest,
  normalizeHost,
  seedHosts,
} from './rosterHosts.ts';
import {
  MANAGER_CANDIDATE_COLUMNS,
  PILOT_JURISDICTIONS,
  type RosterHostManifest,
} from './rosterTypes.ts';
import { COUNTRY_LOCATIONS } from './types.ts';

const PACKAGE_ROOT = join(import.meta.dirname, '..');

type ManagerCli = {
  phase: 'pilot' | 'national';
  runDir: string;
  masterCsv: string;
  jurisdictions: string[];
  rateMs: number;
  resume: boolean;
  headed: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  maxHosts: number | null;
  precisionPct: number | null;
  collectOnly: boolean;
  mergeOnly: boolean;
};

function parseArgs(argv: string[]): ManagerCli {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  const phase = (get('--phase') as 'pilot' | 'national' | undefined) ?? 'pilot';
  const jurisdictionsRaw = get('--jurisdictions');
  const jurisdictions = jurisdictionsRaw
    ? jurisdictionsRaw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean)
    : phase === 'pilot'
      ? [...PILOT_JURISDICTIONS]
      : [...COUNTRY_LOCATIONS.US, ...COUNTRY_LOCATIONS.CA];
  const runDirInput = get('--run-dir') ?? 'output/runs/us-ca-enumeration';
  const masterCsvInput =
    get('--master-csv') ?? join(runDirInput, 'agents.csv');
  const rateMs = Number(get('--rate-ms') ?? '2000');
  const maxHostsRaw = get('--max-hosts');
  const precisionRaw = get('--precision-pct');
  return {
    phase,
    runDir: isAbsolute(runDirInput) ? runDirInput : resolve(PACKAGE_ROOT, runDirInput),
    masterCsv: isAbsolute(masterCsvInput)
      ? masterCsvInput
      : resolve(PACKAGE_ROOT, masterCsvInput),
    jurisdictions,
    rateMs: Number.isFinite(rateMs) ? rateMs : 2000,
    resume: has('--resume'),
    headed: !has('--headless'),
    cdpUrl: get('--cdp-url'),
    userDataDir: get('--user-data-dir'),
    maxHosts: maxHostsRaw != null ? Number(maxHostsRaw) : null,
    precisionPct: precisionRaw != null ? Number(precisionRaw) : null,
    collectOnly: has('--collect-only'),
    mergeOnly: has('--merge-only'),
  };
}

function loadMaster(path: string): MasterAgent[] {
  if (!existsSync(path)) throw new Error(`missing master CSV: ${path}`);
  return readCsv(path).map((row) => ({
    id: row.id ?? '',
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    country: row.country ?? '',
    bio: row.bio ?? '',
  }));
}

function manifestPath(runDir: string): string {
  return join(runDir, 'roster_host_manifest.json');
}

function ensureManifest(
  runDir: string,
  jurisdictions: string[],
  resume: boolean,
): RosterHostManifest {
  const existing =
    resume && loadJson<RosterHostManifest>(manifestPath(runDir))
      ? loadJson<RosterHostManifest>(manifestPath(runDir))!
      : null;
  const seeded = seedHosts({ jurisdictions, includeWww: true });
  const manifest = mergeHostManifest(existing, seeded);
  saveJson(manifestPath(runDir), manifest);
  return manifest;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.runDir, { recursive: true });
  console.log(
    `[managers] phase=${cli.phase} jurisdictions=${cli.jurisdictions.join(',')} runDir=${cli.runDir}`,
  );

  if (cli.phase === 'national') {
    const priorSummary = loadJson<{
      qualityGate?: { passed?: boolean; notes?: string[] };
      phase?: string;
    }>(join(cli.runDir, 'manager_run_summary.json'));
    const priorStop = loadJson<{ decision?: string }>(
      join(cli.runDir, 'manager_national_gate_stop.json'),
    );
    if (priorStop?.decision === 'STOP_NATIONAL_SCALE') {
      throw new Error(
        'National phase refused: prior pilot recorded STOP_NATIONAL_SCALE in manager_national_gate_stop.json.',
      );
    }
    if (!priorSummary?.qualityGate?.passed) {
      throw new Error(
        'National phase refused: quality gate not passed. Complete pilot review with --precision-pct and >=70% coverage first.',
      );
    }
  }

  let manifest = ensureManifest(cli.runDir, cli.jurisdictions, cli.resume);
  const scopedHosts = hostsForJurisdictions(manifest, cli.jurisdictions);
  console.log(`[managers] seeded/loaded hosts=${scopedHosts.length}`);

  if (!cli.mergeOnly) {
    const { captures, manifestUpdates, checkpoint } = await collectRosters({
      runDir: cli.runDir,
      hosts: scopedHosts,
      rateMs: cli.rateMs,
      resume: cli.resume,
      headed: cli.headed,
      cdpUrl: cli.cdpUrl,
      userDataDir: cli.userDataDir,
      maxHosts: cli.maxHosts,
    });
    manifest = applyManifestUpdates(manifest, manifestUpdates);
    saveJson(manifestPath(cli.runDir), manifest);
    console.log(
      `[managers] capture done completed=${checkpoint.completedHosts.length} failed=${checkpoint.failedHosts.length} captures=${captures.length}`,
    );
    if (cli.collectOnly) return;
  } else {
    // Merge-only: mark existing captures healthy so coverage reports list hosts.
    const existingCaptures = loadAllCaptures(cli.runDir);
    const updates = existingCaptures.map((capture) => {
      const normalized = normalizeHost(capture.host);
      const prior = manifest.hosts.find((host) => normalizeHost(host.host) === normalized);
      const prefix = hostPrefix(normalized);
      return {
        host: normalized,
        prefix,
        jurisdictions:
          prior?.jurisdictions?.length ? prior.jurisdictions : guessJurisdictions(prefix),
        kind: prior?.kind ?? 'regional',
        status: 'healthy' as const,
        rosterCount: capture.count ?? capture.agents.length,
        agentsPhpOk: true,
        lastProbedAt: prior?.lastProbedAt ?? capture.capturedAt,
        lastCapturedAt: capture.capturedAt,
        error: null,
        source: prior?.source ?? 'discovered',
      };
    });
    manifest = applyManifestUpdates(manifest, updates);
    saveJson(manifestPath(cli.runDir), manifest);
  }

  const scopedHostSet = new Set(scopedHosts.map((host) => normalizeHost(host.host)));
  const captures = loadAllCaptures(cli.runDir).filter((capture) => {
    const normalized = normalizeHost(capture.host);
    if (scopedHostSet.has(normalized)) return true;
    const host = manifest.hosts.find(
      (row) => normalizeHost(row.host) === normalized,
    );
    const jurisdictions = host?.jurisdictions?.length
      ? host.jurisdictions
      : guessJurisdictions(hostPrefix(normalized));
    return jurisdictions.some((jurisdiction) =>
      cli.jurisdictions.includes(jurisdiction.toUpperCase()),
    );
  });
  const master = loadMaster(cli.masterCsv);
  const merge = mergeAndClassify({
    master,
    captures,
    jurisdictions: cli.jurisdictions,
    manifest,
  });

  const reviewSample = buildReviewSample(merge, 25);
  writeCsv(
    join(cli.runDir, 'agent_managers_review_sample.csv'),
    MANAGER_CANDIDATE_COLUMNS,
    reviewSample,
  );

  const healthyHosts = manifest.hosts.filter(
    (host) =>
      host.status === 'healthy' &&
      host.jurisdictions.some((jurisdiction) =>
        cli.jurisdictions.includes(jurisdiction.toUpperCase()),
      ),
  ).length;

  const summary = writeManagerOutputs({
    runDir: cli.runDir,
    phase: cli.phase,
    jurisdictions: cli.jurisdictions,
    hostsAttempted: scopedHosts.length,
    hostsHealthy: healthyHosts,
    merge,
    precisionPct: cli.precisionPct,
  });

  console.log(
    `[managers] high=${summary.highConfidence} medium=${summary.mediumConfidence} matched=${summary.matchedMasterIds} unmatched=${summary.unmatchedRosterProfiles}`,
  );
  for (const [jurisdiction, coverage] of Object.entries(summary.coverageByJurisdiction)) {
    console.log(
      `[managers] coverage ${jurisdiction}: ${coverage.coveragePct}% (${coverage.matchedMasterIds}/${coverage.masterRows}) high=${coverage.high} medium=${coverage.medium} hosts=${coverage.hosts.length}`,
    );
  }
  console.log(
    `[managers] qualityGate passed=${summary.qualityGate.passed} coveragePassed=${summary.qualityGate.coveragePassed} precisionPassed=${summary.qualityGate.precisionPassed}`,
  );
  for (const note of summary.qualityGate.notes) {
    console.log(`[managers] gate: ${note}`);
  }

  if (cli.phase === 'national' && !summary.qualityGate.passed) {
    throw new Error(
      'National phase refused after merge: quality gate not passed.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
