import { existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { assessCaptureIntegrity, findDuplicateTinyCaptures } from './captureIntegrity.ts';
import { loadJson, saveJson } from './checkpoint.ts';
import { collectRosters, applyManifestUpdates } from './collectRosters.ts';
import { readCsv, writeCsv } from './csv.ts';
import { discoverRosterHosts } from './discoverRosterHosts.ts';
import { ingestLicenseFile } from './licenses/ingest.ts';
import { matchLicensesToMaster } from './licenses/matchToMaster.ts';
import { writeLicensePilotReports } from './licenses/pilotGate.ts';
import {
  buildBrokerLeadRows,
  mergeBioCandidates,
  mergeLicenseMatches,
  mergeRosterCaptures,
  toBrokerLeadRow,
  writeBrokerExpansionOutputs,
} from './mergeBrokerExpansion.ts';
import type { LicenseMatchResult } from './brokerExpansionTypes.ts';
import type { MasterAgent } from './rosterMatch.ts';
import {
  guessJurisdictions,
  hostPrefix,
  mergeHostManifest,
  normalizeHost,
  seedHosts,
} from './rosterHosts.ts';
import type { CapturedRoster, RosterHostManifest } from './rosterTypes.ts';
import { COUNTRY_LOCATIONS } from './types.ts';

const PACKAGE_ROOT = join(import.meta.dirname, '..');

type Cli = {
  runDir: string;
  masterCsv: string;
  captureDir: string;
  sourceRunDir: string | null;
  resume: boolean;
  headed: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  rateMs: number;
  maxHosts: number | null;
  discover: boolean;
  collect: boolean;
  bio: boolean;
  licenses: boolean;
  mergeOnly: boolean;
  caFile?: string;
  txFile?: string;
  flFile?: string;
};

function parseArgs(argv: string[]): Cli {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  const runDirInput = get('--run-dir') ?? 'output/runs/us-ca-broker-expansion';
  const sourceRunDir = get('--source-run-dir') ?? 'output/runs/us-ca-enumeration';
  const runDir = isAbsolute(runDirInput) ? runDirInput : resolve(PACKAGE_ROOT, runDirInput);
  const sourceAbs = isAbsolute(sourceRunDir)
    ? sourceRunDir
    : resolve(PACKAGE_ROOT, sourceRunDir);
  const masterCsvInput = get('--master-csv') ?? join(sourceAbs, 'agents.csv');
  const captureDirInput = get('--capture-dir') ?? join(runDir, 'roster_captures');
  const rateMs = Number(get('--rate-ms') ?? '1500');
  const maxHostsRaw = get('--max-hosts');
  const mergeOnly = has('--merge-only');
  return {
    runDir,
    masterCsv: isAbsolute(masterCsvInput)
      ? masterCsvInput
      : resolve(PACKAGE_ROOT, masterCsvInput),
    captureDir: isAbsolute(captureDirInput)
      ? captureDirInput
      : resolve(PACKAGE_ROOT, captureDirInput),
    sourceRunDir: sourceAbs,
    resume: has('--resume'),
    headed: !has('--headless'),
    cdpUrl: get('--cdp-url'),
    userDataDir: get('--user-data-dir'),
    rateMs: Number.isFinite(rateMs) ? rateMs : 1500,
    maxHosts: maxHostsRaw != null ? Number(maxHostsRaw) : null,
    discover: has('--discover') || (!mergeOnly && !has('--no-discover')),
    collect: has('--collect') || (!mergeOnly && !has('--no-collect')),
    bio: has('--bio') || (!has('--no-bio') && (mergeOnly || true)),
    licenses: has('--licenses') || Boolean(get('--ca-file') || get('--tx-file') || get('--fl-file')),
    mergeOnly,
    caFile: get('--ca-file'),
    txFile: get('--tx-file'),
    flFile: get('--fl-file'),
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

function ensureCaptureDirFromSource(cli: Cli): void {
  mkdirSync(cli.captureDir, { recursive: true });
  if (!cli.sourceRunDir) return;
  const sourceCaptures = join(cli.sourceRunDir, 'roster_captures');
  if (!existsSync(sourceCaptures)) return;
  if (resolve(sourceCaptures) === resolve(cli.captureDir)) return;

  // Copy JSON captures into the expansion namespace so pilot artifacts stay untouched.
  for (const name of readdirSync(sourceCaptures)) {
    if (!name.endsWith('.json') || name.endsWith('.meta.json')) continue;
    const dest = join(cli.captureDir, name);
    if (existsSync(dest) && cli.resume) continue;
    cpSync(join(sourceCaptures, name), dest);
  }

  const sourceManifest = join(cli.sourceRunDir, 'roster_host_manifest.json');
  const destManifest = join(cli.runDir, 'roster_host_manifest.json');
  if (existsSync(sourceManifest) && (!existsSync(destManifest) || !cli.resume)) {
    cpSync(sourceManifest, destManifest);
  }
}

function loadCapturesFromDir(captureDir: string): CapturedRoster[] {
  if (!existsSync(captureDir)) return [];
  return readdirSync(captureDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.meta.json'))
    .map((name) => loadJson<CapturedRoster>(join(captureDir, name)))
    .filter((row): row is CapturedRoster => Boolean(row?.host && Array.isArray(row.agents)));
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.runDir, { recursive: true });
  ensureCaptureDirFromSource(cli);

  console.log(
    `[broker-expansion] runDir=${cli.runDir} master=${cli.masterCsv} captures=${cli.captureDir}`,
  );

  let manifest =
    loadJson<RosterHostManifest>(join(cli.runDir, 'roster_host_manifest.json')) ??
    mergeHostManifest(null, seedHosts({
      jurisdictions: [...COUNTRY_LOCATIONS.US, ...COUNTRY_LOCATIONS.CA],
      includeWww: true,
    }));

  let discoverySummary: {
    hostsAttempted: number;
    hostsHealthy: number;
    hostsPersonalOrTiny: number;
    plateauReached: boolean;
    notes: string[];
  } | undefined;

  if (!cli.mergeOnly && cli.discover) {
    const { manifest: discovered, report } = await discoverRosterHosts({
      runDir: cli.runDir,
      jurisdictions: [...COUNTRY_LOCATIONS.US, ...COUNTRY_LOCATIONS.CA],
      rateMs: Math.min(cli.rateMs, 1000),
      resume: cli.resume,
      headed: cli.headed,
      cdpUrl: cli.cdpUrl,
      userDataDir: cli.userDataDir,
      maxHosts: cli.maxHosts,
    });
    manifest = discovered;
    discoverySummary = {
      hostsAttempted: report.attempted,
      hostsHealthy: report.healthy,
      hostsPersonalOrTiny: report.personalOrTiny,
      plateauReached: report.plateauReached,
      notes: report.notes,
    };
    console.log(
      `[broker-expansion] discovery attempted=${report.attempted} healthy=${report.healthy} plateau=${report.plateauReached}`,
    );
  }

  if (!cli.mergeOnly && cli.collect) {
    const pending = manifest.hosts.filter((host) => host.status === 'healthy' || host.status === 'pending');
    const { captures, manifestUpdates, checkpoint } = await collectRosters({
      runDir: cli.runDir,
      hosts: pending,
      rateMs: cli.rateMs,
      resume: cli.resume,
      headed: cli.headed,
      cdpUrl: cli.cdpUrl,
      userDataDir: cli.userDataDir,
      maxHosts: cli.maxHosts,
    });
    manifest = applyManifestUpdates(manifest, manifestUpdates);
    saveJson(join(cli.runDir, 'roster_host_manifest.json'), manifest);
    // Ensure captures land in the configured capture dir when runDir-based collector wrote elsewhere.
    for (const capture of captures) {
      const hostname = new URL(normalizeHost(capture.host)).hostname.replace(/\./g, '_');
      const dest = join(cli.captureDir, `${hostname}.json`);
      if (!existsSync(dest)) saveJson(dest, capture);
    }
    console.log(
      `[broker-expansion] collect completed=${checkpoint.completedHosts.length} failed=${checkpoint.failedHosts.length}`,
    );
  }

  const captures = loadCapturesFromDir(cli.captureDir);
  const integrity = captures.map(assessCaptureIntegrity);
  const tinyDupes = findDuplicateTinyCaptures(captures);
  saveJson(join(cli.runDir, 'capture_integrity_report.json'), {
    generatedAt: new Date().toISOString(),
    captures: integrity,
    duplicateTinyHosts: tinyDupes,
  });
  if (tinyDupes.length) {
    console.warn(
      `[broker-expansion] suspicious tiny duplicate captures: ${tinyDupes
        .map((row) => `${row.agentId} @ ${row.hosts.join(',')}`)
        .join(' ; ')}`,
    );
  }

  // Refresh manifest health from captures without requiring collect.
  const captureUpdates = captures.map((capture) => {
    const host = normalizeHost(capture.host);
    const prior = manifest.hosts.find((row) => normalizeHost(row.host) === host);
    const prefix = hostPrefix(host);
    const assessment = assessCaptureIntegrity(capture);
    return {
      host,
      prefix,
      jurisdictions:
        prior?.jurisdictions?.length ? prior.jurisdictions : guessJurisdictions(prefix),
      kind:
        assessment.kind === 'suspicious_tiny'
          ? 'personal'
          : assessment.kind === 'regional' || assessment.kind === 'personal'
            ? assessment.kind
            : prior?.kind ?? 'unknown',
      status: 'healthy' as const,
      rosterCount: capture.count ?? capture.agents.length,
      agentsPhpOk: true,
      lastProbedAt: prior?.lastProbedAt ?? capture.capturedAt,
      lastCapturedAt: capture.capturedAt,
      error: assessment.trustedForCoverage ? null : assessment.reason,
      source: prior?.source ?? 'discovered',
    };
  });
  manifest = applyManifestUpdates(manifest, captureUpdates);
  saveJson(join(cli.runDir, 'roster_host_manifest.json'), manifest);

  const master = loadMaster(cli.masterCsv);
  const rosterMerge = mergeRosterCaptures({
    master,
    captures,
    manifest,
  });

  let bioCandidates = 0;
  if (cli.bio) {
    bioCandidates = mergeBioCandidates(rosterMerge.byMaster, master);
    console.log(`[broker-expansion] bio candidates added/updated=${bioCandidates}`);
  }

  let licenseMatchCount = 0;
  let licenseMatches: LicenseMatchResult[] = [];
  let licenseAmbiguous: LicenseMatchResult[] = [];
  if (cli.licenses) {
    const allLicenses = [];
    const metas = [];
    for (const [source, file] of [
      ['ca_dre', cli.caFile],
      ['tx_trec', cli.txFile],
      ['fl_dbpr', cli.flFile],
    ] as const) {
      if (!file) continue;
      const { records, meta } = ingestLicenseFile({
        source,
        inputPath: file,
        runDir: cli.runDir,
      });
      for (const record of records) allLicenses.push(record);
      metas.push(meta);
      console.log(`[broker-expansion] ingested ${source} rows=${meta.rowCount}`);
    }
    console.log(`[broker-expansion] matching licenses against master (${allLicenses.length} rows)...`);
    const matchResult = matchLicensesToMaster(master, allLicenses);
    saveJson(join(cli.runDir, 'license_match_report.json'), {
      generatedAt: new Date().toISOString(),
      sources: metas,
      matched: matchResult.matches.length,
      ambiguous: matchResult.ambiguous.length,
      unmatchedLicenses: matchResult.unmatchedLicenses,
      brokerishLicenses: matchResult.brokerishLicenses,
    });
    writeCsv(
      join(cli.runDir, 'license_match_ambiguous.csv'),
      [
        'master_id',
        'license_number',
        'license_type',
        'full_name',
        'state',
        'match_method',
      ],
      matchResult.ambiguous.map((row) => ({
        master_id: row.masterId,
        license_number: row.license.licenseNumber,
        license_type: row.license.licenseType,
        full_name: row.license.fullName,
        state: row.license.state,
        match_method: row.matchMethod,
      })),
    );
    licenseMatches = matchResult.matches;
    licenseAmbiguous = matchResult.ambiguous;
    licenseMatchCount = mergeLicenseMatches(
      rosterMerge.byMaster,
      new Map(master.map((row) => [row.id, row])),
      matchResult.matches,
    );
    console.log(
      `[broker-expansion] license matches applied=${licenseMatchCount} ambiguous=${matchResult.ambiguous.length}`,
    );
  }

  const rows = buildBrokerLeadRows(rosterMerge.byMaster);
  const unmatched = rosterMerge.unmatched.map(toBrokerLeadRow);
  const matchedMasterIds = new Set(
    rows.map((row) => row.master_id).filter(Boolean),
  ).size;
  const summary = writeBrokerExpansionOutputs({
    runDir: cli.runDir,
    masterCsv: cli.masterCsv,
    captureDir: cli.captureDir,
    rows,
    unmatched,
    uniqueRosterAgents: rosterMerge.uniqueRosterAgents,
    matchedMasterIds,
    bioCandidates,
    licenseMatches: licenseMatchCount,
    rosterCaptures: captures.length,
    discovery: discoverySummary,
  });

  if (cli.licenses) {
    const gate = writeLicensePilotReports({
      runDir: cli.runDir,
      rows,
      matches: licenseMatches,
      ambiguous: licenseAmbiguous,
    });
    console.log(
      `[broker-expansion] license pilot gate=${gate.decision} strong=${gate.strongMethodMatches} nameStateReview=${gate.nameStateMatchesNeedingReview}`,
    );
  }

  console.log(
    `[broker-expansion] leads=${rows.length} A=${summary.tiers.A ?? 0} B=${summary.tiers.B ?? 0} C=${summary.tiers.C ?? 0} D=${summary.tiers.D ?? 0} unmatched=${unmatched.length}`,
  );
  console.log(`[broker-expansion] summary=${summary.outputs.summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
