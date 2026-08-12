import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsv } from '../lib/csv.js';
import { STAGE3_COLUMNS, type Stage3Row } from '../lib/types.js';
import type { ApiCallCounts } from '../lib/callCounter.js';
import type { ShortlinkCache } from './urlExpander.js';
import { dedupeEntities } from './dedupeEntities.js';

export const STAGE3_CHECKPOINT_FILE = 'stage3_checkpoint.json';
export const STAGE3_ENRICHMENT_LOG_FILE = 'stage3_enrichment_log.jsonl';
export const STAGE3_CSV_FILE = 'stage3_webinar_host_entities.csv';

export type Stage3Stats = {
  ok: number;
  partial: number;
  not_found: number;
};

export type EnrichmentLogEntry = {
  group_index: number;
  group_key: string;
  entity_source: string;
  enrichment_status: string;
  company_name: string;
  api_calls: ApiCallCounts;
  stats: Stage3Stats;
};

export type Stage3Checkpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  input_path: string;
  input_fingerprint: string;
  output_path: string;
  started_at: string;
  updated_at: string;
  next_group_index: number;
  total_groups: number;
  api_calls: ApiCallCounts;
  stats: Stage3Stats;
  rows: Stage3Row[];
  shortlink_cache: ShortlinkCache;
};

export function inputFingerprint(inputPath: string, groupKeys: string[]): string {
  const payload = JSON.stringify({ inputPath, groupKeys });
  return createHash('sha256').update(payload).digest('hex');
}

export function fingerprintFromGroups(inputPath: string, groupKeys: string[]): string {
  return inputFingerprint(inputPath, groupKeys);
}

export function computeStage3Stats(rows: Stage3Row[]): Stage3Stats {
  return {
    ok: rows.filter((r) => r.enrichment_status === 'ok').length,
    partial: rows.filter((r) => r.enrichment_status === 'partial').length,
    not_found: rows.filter((r) => r.enrichment_status === 'not_found').length,
  };
}

export function checkpointPath(runDir: string): string {
  return join(runDir, STAGE3_CHECKPOINT_FILE);
}

export function enrichmentLogPath(runDir: string): string {
  return join(runDir, STAGE3_ENRICHMENT_LOG_FILE);
}

export function defaultCsvPath(runDir: string): string {
  return join(runDir, STAGE3_CSV_FILE);
}

export function createEmptyCheckpoint(input: {
  inputPath: string;
  inputFingerprint: string;
  outputPath: string;
  totalGroups: number;
}): Stage3Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    input_path: input.inputPath,
    input_fingerprint: input.inputFingerprint,
    output_path: input.outputPath,
    started_at: now,
    updated_at: now,
    next_group_index: 0,
    total_groups: input.totalGroups,
    api_calls: {
      serper_searches: 0,
      apollo_org_calls: 0,
      apollo_people_calls: 0,
      openrouter_calls: 0,
      linkedin_navigations: 0,
    },
    stats: { ok: 0, partial: 0, not_found: 0 },
    rows: [],
    shortlink_cache: {},
  };
}

export function loadCheckpoint(runDir: string): Stage3Checkpoint {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) {
    throw new Error(`No Stage 3 checkpoint found at ${path}. Start a new run or check the run directory.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Stage3Checkpoint;
}

export function assertCheckpointCompatible(
  checkpoint: Stage3Checkpoint,
  inputPath: string,
  fingerprint: string,
): void {
  if (checkpoint.input_fingerprint !== fingerprint) {
    throw new Error(
      'Stage 3 checkpoint input fingerprint does not match (input CSV changed). Start a new run.',
    );
  }
  if (resolvePath(checkpoint.input_path) !== resolvePath(inputPath)) {
    throw new Error(
      `Stage 3 checkpoint input path mismatch. Expected ${checkpoint.input_path}, got ${inputPath}.`,
    );
  }
  if (checkpoint.status === 'completed') {
    throw new Error('Stage 3 checkpoint is already completed. Start a new run or use the existing CSV output.');
  }
}

function resolvePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function persistStage3State(
  runDir: string,
  checkpoint: Stage3Checkpoint,
  rows: Stage3Row[],
  csvOutputPath?: string,
): void {
  mkdirSync(runDir, { recursive: true });
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.rows = rows;
  checkpoint.stats = computeStage3Stats(dedupeEntities(rows));
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  writeCsv(csvOutputPath ?? checkpoint.output_path, dedupeEntities(rows), [...STAGE3_COLUMNS]);
}

export function appendEnrichmentLog(runDir: string, entry: EnrichmentLogEntry): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(enrichmentLogPath(runDir), `${JSON.stringify(entry)}\n`, 'utf8');
}
