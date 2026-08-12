import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueriesConfig } from '../lib/config.js';
import { writeCsv } from '../lib/csv.js';
import { STAGE1_COLUMNS, type Stage1Row } from '../lib/types.js';
import { dedupeStage1Rows } from './parser.js';

export const STAGE1_CHECKPOINT_FILE = 'stage1_checkpoint.json';
export const STAGE1_PAGE_LOG_FILE = 'stage1_page_log.jsonl';
export const STAGE1_CSV_FILE = 'stage1_linkedin_webinar_posts.csv';

export type QueryStopReason =
  | 'exhausted'
  | 'yield_zero'
  | 'yield_low'
  | 'page_cap'
  | 'interrupted'
  | 'pending';

export type QuerySummary = {
  phrase: string;
  search_query: string;
  pages_fetched: number;
  new_urls: number;
  stop_reason: QueryStopReason;
};

export type PageLogEntry = {
  phrase_index: number;
  search_query: string;
  serp_page: number;
  organic_count: number;
  linkedin_count: number;
  new_urls: number;
  cumulative_unique: number;
  serper_searches: number;
  action: string;
};

export type Stage1Checkpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  config_fingerprint: string;
  started_at: string;
  updated_at: string;
  serper_searches: number;
  unique_urls: number;
  next_phrase_index: number;
  next_page: number;
  seen_urls: string[];
  rows: Stage1Row[];
  query_summaries: QuerySummary[];
};

export function configFingerprint(config: Pick<QueriesConfig, 'phrases' | 'time_filter'>): string {
  const payload = JSON.stringify({ phrases: config.phrases, time_filter: config.time_filter });
  return createHash('sha256').update(payload).digest('hex');
}

export function checkpointPath(runDir: string): string {
  return join(runDir, STAGE1_CHECKPOINT_FILE);
}

export function pageLogPath(runDir: string): string {
  return join(runDir, STAGE1_PAGE_LOG_FILE);
}

export function csvPath(runDir: string): string {
  return join(runDir, STAGE1_CSV_FILE);
}

export function createEmptyCheckpoint(
  config: QueriesConfig,
  phrases: string[],
): Stage1Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    config_fingerprint: configFingerprint(config),
    started_at: now,
    updated_at: now,
    serper_searches: 0,
    unique_urls: 0,
    next_phrase_index: 0,
    next_page: 1,
    seen_urls: [],
    rows: [],
    query_summaries: phrases.map((phrase) => ({
      phrase,
      search_query: '',
      pages_fetched: 0,
      new_urls: 0,
      stop_reason: 'pending',
    })),
  };
}

export function loadCheckpoint(runDir: string): Stage1Checkpoint {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) {
    throw new Error(`No checkpoint found at ${path}. Start a new run or check the run directory.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Stage1Checkpoint;
}

export function assertCheckpointCompatible(checkpoint: Stage1Checkpoint, config: QueriesConfig): void {
  const expected = configFingerprint(config);
  if (checkpoint.config_fingerprint !== expected) {
    throw new Error(
      'Checkpoint config fingerprint does not match queries.yaml (phrases or time_filter changed). Start a new run.',
    );
  }
  if (checkpoint.status === 'completed') {
    throw new Error('Checkpoint is already completed. Start a new run or use the existing CSV output.');
  }
}

export function seenUrlsFromCheckpoint(checkpoint: Stage1Checkpoint): Set<string> {
  return new Set(checkpoint.seen_urls);
}

export function mergePageRows(
  existingRows: Stage1Row[],
  pageRows: Stage1Row[],
  seenUrls: Set<string>,
): { rows: Stage1Row[]; newUrlCount: number } {
  const newUrls: string[] = [];
  for (const row of pageRows) {
    if (!seenUrls.has(row.result_url)) {
      newUrls.push(row.result_url);
    }
  }

  const merged = dedupeStage1Rows([...existingRows, ...pageRows]);
  for (const url of newUrls) {
    seenUrls.add(url);
  }

  return { rows: merged, newUrlCount: newUrls.length };
}

export function persistCheckpointState(
  runDir: string,
  checkpoint: Stage1Checkpoint,
  rows: Stage1Row[],
  seenUrls: Set<string>,
  csvOutputPath?: string,
): void {
  mkdirSync(runDir, { recursive: true });
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.seen_urls = [...seenUrls];
  checkpoint.rows = rows;
  checkpoint.unique_urls = rows.length;
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  writeCsv(csvOutputPath ?? csvPath(runDir), rows, [...STAGE1_COLUMNS]);
}

export function appendPageLog(runDir: string, entry: PageLogEntry): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(pageLogPath(runDir), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function markQuerySummary(
  checkpoint: Stage1Checkpoint,
  phraseIndex: number,
  patch: Partial<QuerySummary>,
): void {
  const summary = checkpoint.query_summaries[phraseIndex];
  if (!summary) return;
  Object.assign(summary, patch);
}
