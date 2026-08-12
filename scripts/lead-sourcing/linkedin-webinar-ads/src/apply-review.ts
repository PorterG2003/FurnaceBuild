import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG } from './config.js';
import { loadCheckpoint, writeCsv, writeJson } from './io.js';
import { applyReviewDecisions, buildAdvertiserRows, normalizeAndFilter, toAdCsvRow } from './pipeline.js';
import type { ReviewDecision } from './types.js';

const COLUMNS = [
  'platform', 'ad_id', 'advertiser_name', 'advertiser_url', 'payer_name', 'primary_text', 'headline',
  'landing_url', 'active_from', 'active_to', 'status', 'phrases', 'person_name', 'person_evidence',
  'live_signals', 'exclusion_reasons', 'disposition', 'dedupe_key', 'advertiser_key', 'search_url',
  'collected_at', 'extraction_confidence',
];

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Usage: apply-review --run-dir <run directory> --decisions <review-decisions.json>`);
  return process.argv[index + 1]!;
}

function main(): void {
  const root = process.env.INIT_CWD ?? process.cwd();
  const runDir = resolve(root, arg('--run-dir'));
  const decisionPath = resolve(root, arg('--decisions'));
  const checkpoint = loadCheckpoint(runDir);
  if (!checkpoint) throw new Error(`Missing checkpoint in ${runDir}`);
  const raw = JSON.parse(readFileSync(decisionPath, 'utf8')) as { version: number; decisions: ReviewDecision[] };
  if (raw.version !== 1 || !Array.isArray(raw.decisions)) throw new Error('Invalid review decisions file');
  writeJson(join(runDir, 'review-decisions.applied.json'), raw);
  const ads = applyReviewDecisions(normalizeAndFilter(checkpoint.rawAds, DEFAULT_CONFIG), raw.decisions);
  const rows = ads.map(toAdCsvRow);
  writeCsv(join(runDir, 'ads_normalized.csv'), rows, COLUMNS);
  writeCsv(join(runDir, 'ads_filtered.csv'), rows.filter((row) => row.disposition === 'qualified'), COLUMNS);
  writeCsv(join(runDir, 'ads_excluded.csv'), rows.filter((row) => row.disposition === 'excluded'), COLUMNS);
  writeCsv(join(runDir, 'ads_review.csv'), rows.filter((row) => row.disposition === 'review'), COLUMNS);
  const advertisers = buildAdvertiserRows(ads);
  writeCsv(join(runDir, 'advertisers.csv'), advertisers, Object.keys(advertisers[0] ?? { advertiser_key: '', advertiser_name: '', advertiser_url: '', landing_domain: '', person_name: '', person_evidence: '', representative_ad_id: '', representative_copy: '', representative_headline: '', representative_landing_url: '', active_from: '', phrases: '', qualifying_ad_count: '' }));
  writeJson(join(runDir, 'review_summary.json'), { decisions: raw.decisions.length, qualified: rows.filter((row) => row.disposition === 'qualified').length, excluded: rows.filter((row) => row.disposition === 'excluded').length, review: rows.filter((row) => row.disposition === 'review').length });
}

main();
