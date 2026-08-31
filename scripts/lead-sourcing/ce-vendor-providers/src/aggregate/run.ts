import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs } from '../lib/cli.js';
import { loadEnv } from '../lib/env.js';
import { readCsv, writeCsv, rowToRecord } from '../lib/csv.js';
import { EVIDENCE_COLUMNS, HOST_PROSPECT_COLUMNS, PROSPECT_COLUMNS, type FitRecord } from '../lib/types.js';
import { aggregateProspects, isHostKeepLeak } from './tiers.js';
import { buildCoverageReport } from './coverageReport.js';
import { defaultWebinarHostsRunDir, loadWebinarHostCeSlice } from './mergeHosts.js';

export function coerceFit(row: Record<string, string>): FitRecord {
  return {
    provider_name: row.provider_name || row.company_name || '',
    source_directory: row.source_directory || '',
    accreditor: row.accreditor || '',
    audience_profession: row.audience_profession || '',
    source_url: row.source_url || '',
    listed_website: row.listed_website || '',
    entity_class: (row.entity_class as FitRecord['entity_class']) || 'unknown',
    company_sells_what: row.company_sells_what || '',
    class_reason: row.class_reason || row.extract_snippet || '',
    homepage_url: row.homepage_url || '',
    audience_relationship: (row.audience_relationship as FitRecord['audience_relationship']) || 'unknown',
    has_formal_grant_program: row.has_formal_grant_program === 'true',
    registration_host_domain: row.registration_host_domain || '',
    registration_kind: (row.registration_kind as FitRecord['registration_kind']) || 'unknown',
    registration_url: row.registration_url || '',
    is_free: row.is_free === 'true' ? true : row.is_free === 'false' ? false : null,
    self_provided: row.self_provided === 'true',
    ce_page_url: row.ce_page_url || row.source_url || '',
    activity_title: row.activity_title || row.page_title || '',
    ce_formats: row.ce_formats || '',
    primary_ce_format: (row.primary_ce_format as FitRecord['primary_ce_format']) || 'unknown',
    has_live_online: row.has_live_online === 'true',
    needs_review: row.needs_review === 'true',
    source_kind: (row.source_kind as FitRecord['source_kind']) || 'directory',
  };
}

export function aggregateRun(runDir: string): {
  prospectsPath: string;
  evidencePath: string;
  coveragePath: string;
  hostProspectsPath: string;
  hostKeepPath: string;
} {
  const fitPath = join(runDir, 'fit_entries.csv');
  const hostPath = join(runDir, 'host_activities.csv');
  const grantPath = join(runDir, 'grant_activities.csv');
  const unmatchedPath = join(runDir, 'unmatched.csv');

  const fitRows = existsSync(fitPath) ? readCsv(fitPath).map(coerceFit) : [];
  const hostRows = existsSync(hostPath) ? readCsv(hostPath).map(coerceFit) : [];
  const grantRows = existsSync(grantPath) ? readCsv(grantPath).map(coerceFit) : [];
  const unmatched = existsSync(unmatchedPath) ? readCsv(unmatchedPath).length : 0;

  const merged = [...fitRows, ...hostRows, ...grantRows];
  const { prospects, evidence } = aggregateProspects(merged);

  const prospectsPath = join(runDir, 'prospects.csv');
  const evidencePath = join(runDir, 'evidence.csv');
  const coveragePath = join(runDir, 'coverage_report.json');

  writeCsv(prospectsPath, prospects.map((p) => rowToRecord(p)), [...PROSPECT_COLUMNS]);
  writeCsv(
    evidencePath,
    evidence.map((e) => rowToRecord({ ...e, fit_tier: e.fit_tier ?? '' })),
    [...EVIDENCE_COLUMNS],
  );

  const hostProspects = prospects
    .filter((p) => (p.host_tier ?? 0) > 0)
    .sort((a, b) => {
      const ta = a.host_tier ?? 99;
      const tb = b.host_tier ?? 99;
      if (ta !== tb) return ta - tb;
      return a.company_name.localeCompare(b.company_name);
    });
  const hostProspectsPath = join(runDir, 'host_prospects.csv');
  writeCsv(
    hostProspectsPath,
    hostProspects.map((p) => rowToRecord(p)),
    [...HOST_PROSPECT_COLUMNS],
  );

  const hostKeep = hostProspects.filter((p) => !isHostKeepLeak(p.company_name));
  const hostKeepPath = join(runDir, 'host_keep.csv');
  writeCsv(
    hostKeepPath,
    hostKeep.map((p) => rowToRecord(p)),
    [...HOST_PROSPECT_COLUMNS],
  );

  const webinarDir = defaultWebinarHostsRunDir();
  if (webinarDir) {
    const webinarSlice = loadWebinarHostCeSlice(webinarDir);
    writeFileSync(
      join(runDir, 'webinar_host_ce_slice.json'),
      `${JSON.stringify(
        { runDir: webinarDir, rows: webinarSlice.length, merged_into_host_prospects: false, note: 'side file only' },
        null,
        2,
      )}\n`,
    );
  }

  const report = buildCoverageReport({
    directoryRows: existsSync(join(runDir, 'directory_entries.csv'))
      ? readCsv(join(runDir, 'directory_entries.csv')).length
      : 0,
    classifiedRows: existsSync(join(runDir, 'classified_entries.csv'))
      ? readCsv(join(runDir, 'classified_entries.csv')).length
      : 0,
    fitRows: fitRows.length,
    hostActivities: hostRows.length,
    grantActivities: grantRows.length,
    unmatched,
    prospects,
  });
  writeFileSync(coveragePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { prospectsPath, evidencePath, coveragePath, hostProspectsPath, hostKeepPath };
}

const isCli = process.argv[1]?.endsWith('run.ts') && process.argv[1]?.includes('aggregate');
if (isCli) {
  loadEnv();
  const cli = parseCliArgs();
  if (!cli.runDir) {
    console.error('--run-dir is required');
    process.exit(1);
  }
  const result = aggregateRun(resolve(cli.runDir));
  console.error(`Wrote ${result.prospectsPath}`);
}
