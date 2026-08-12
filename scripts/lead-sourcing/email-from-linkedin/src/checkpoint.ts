import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCallCounts, type ApiCallCounts } from '../../webinar-hosts/src/lib/callCounter.js';
import { writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import {
  ENRICHED_UNIQUE_COLUMNS,
  WITH_EMAIL_COLUMNS,
  type EnrichedUniqueRow,
} from './types.js';

export const CHECKPOINT_FILE = 'checkpoint.json';
export const ENRICHMENT_LOG_FILE = 'enrichment_log.jsonl';
export const ENRICHED_UNIQUE_CSV = 'enriched_unique.csv';
export const ENRICHED_FULL_CSV = 'enriched_full.csv';
export const WITH_EMAIL_CSV = 'with_email.csv';

export type EnrichmentStats = {
  unique_profiles: number;
  processed: number;
  email_found: number;
  matched_no_email: number;
  not_found: number;
  error: number;
};

export type EnrichmentLogEntry = {
  linkedin_url: string;
  reactor_name: string;
  enrichment_status: string;
  match_method: string;
  email: string;
  error?: string;
  stats: EnrichmentStats;
  api_calls: ApiCallCounts;
};

export type EnrichCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  input_path: string;
  started_at: string;
  updated_at: string;
  next_index: number;
  total_unique: number;
  api_calls: ApiCallCounts;
  stats: EnrichmentStats;
  results: EnrichedUniqueRow[];
};

export function emptyStats(uniqueProfiles = 0): EnrichmentStats {
  return {
    unique_profiles: uniqueProfiles,
    processed: 0,
    email_found: 0,
    matched_no_email: 0,
    not_found: 0,
    error: 0,
  };
}

export function bumpStat(stats: EnrichmentStats, status: EnrichedUniqueRow['enrichment_status']): void {
  stats.processed += 1;
  stats[status] += 1;
}

export function checkpointPath(runDir: string): string {
  return join(runDir, CHECKPOINT_FILE);
}

export function loadCheckpoint(runDir: string): EnrichCheckpoint | null {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as EnrichCheckpoint;
}

export function saveCheckpoint(runDir: string, checkpoint: EnrichCheckpoint): void {
  mkdirSync(runDir, { recursive: true });
  checkpoint.updated_at = new Date().toISOString();
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

export function appendEnrichmentLog(runDir: string, entry: EnrichmentLogEntry): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, ENRICHMENT_LOG_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function createCheckpoint(inputPath: string, totalUnique: number): EnrichCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    input_path: inputPath,
    started_at: now,
    updated_at: now,
    next_index: 0,
    total_unique: totalUnique,
    api_calls: emptyCallCounts(),
    stats: emptyStats(totalUnique),
    results: [],
  };
}

export function writeUniqueCsv(runDir: string, rows: EnrichedUniqueRow[]): void {
  writeCsv(
    join(runDir, ENRICHED_UNIQUE_CSV),
    rows as unknown as Record<string, string>[],
    [...ENRICHED_UNIQUE_COLUMNS],
  );
}

export function writeWithEmailCsv(runDir: string, rows: EnrichedUniqueRow[]): void {
  const withEmail = rows.filter((row) => row.enrichment_status === 'email_found' && row.email.includes('@'));
  writeCsv(
    join(runDir, WITH_EMAIL_CSV),
    withEmail as unknown as Record<string, string>[],
    [...WITH_EMAIL_COLUMNS],
  );
}

export function writeOutputs(runDir: string, uniqueRows: EnrichedUniqueRow[]): void {
  writeUniqueCsv(runDir, uniqueRows);
  writeWithEmailCsv(runDir, uniqueRows);
}
