import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsv } from '../lib/csv.js';
import {
  STAGE1_COLUMNS,
  STAGE2_EXTRA_COLUMNS,
  type Stage1Row,
  type Stage2Row,
} from '../lib/types.js';

export const STAGE2_CHECKPOINT_FILE = 'stage2_checkpoint.json';
export const STAGE2_EXTRACTION_LOG_FILE = 'stage2_extraction_log.jsonl';
export const STAGE2_CSV_FILE = 'stage2_linkedin_webinar_posts_extracted.csv';

export const STAGE2_COLUMNS = [...STAGE1_COLUMNS, ...STAGE2_EXTRA_COLUMNS];

export type Stage2Stats = {
  ok: number;
  blocked: number;
  error: number;
};

export type ExtractionLogEntry = {
  row_index: number;
  result_url: string;
  extraction_status: string;
  linkedin_navigations: number;
  stats: Stage2Stats;
};

export type Stage2Checkpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  input_path: string;
  input_fingerprint: string;
  output_path: string;
  started_at: string;
  updated_at: string;
  next_row_index: number;
  total_rows: number;
  linkedin_navigations: number;
  stats: Stage2Stats;
  rows: Stage2Row[];
};

export function inputFingerprint(
  inputPath: string,
  maxRows: number | null,
  urls: string[],
): string {
  const payload = JSON.stringify({
    inputPath,
    maxRows,
    urls,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function computeStage2Stats(rows: Stage2Row[]): Stage2Stats {
  return {
    ok: rows.filter((r) => r.extraction_status === 'ok').length,
    blocked: rows.filter((r) => r.extraction_status === 'blocked').length,
    error: rows.filter((r) => r.extraction_status === 'error').length,
  };
}

export function checkpointPath(runDir: string): string {
  return join(runDir, STAGE2_CHECKPOINT_FILE);
}

export function extractionLogPath(runDir: string): string {
  return join(runDir, STAGE2_EXTRACTION_LOG_FILE);
}

export function defaultCsvPath(runDir: string): string {
  return join(runDir, STAGE2_CSV_FILE);
}

export function createEmptyCheckpoint(input: {
  inputPath: string;
  inputFingerprint: string;
  outputPath: string;
  totalRows: number;
}): Stage2Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    input_path: input.inputPath,
    input_fingerprint: input.inputFingerprint,
    output_path: input.outputPath,
    started_at: now,
    updated_at: now,
    next_row_index: 0,
    total_rows: input.totalRows,
    linkedin_navigations: 0,
    stats: { ok: 0, blocked: 0, error: 0 },
    rows: [],
  };
}

export function loadCheckpoint(runDir: string): Stage2Checkpoint {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) {
    throw new Error(`No Stage 2 checkpoint found at ${path}. Start a new run or check the run directory.`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Stage2Checkpoint;
}

export function assertCheckpointCompatible(
  checkpoint: Stage2Checkpoint,
  inputPath: string,
  fingerprint: string,
  options?: { allowCompleted?: boolean },
): void {
  if (checkpoint.input_fingerprint !== fingerprint) {
    throw new Error(
      'Stage 2 checkpoint input fingerprint does not match (input CSV or --max-rows changed). Start a new run.',
    );
  }
  if (resolvePath(checkpoint.input_path) !== resolvePath(inputPath)) {
    throw new Error(
      `Stage 2 checkpoint input path mismatch. Expected ${checkpoint.input_path}, got ${inputPath}.`,
    );
  }
  if (checkpoint.status === 'completed' && !options?.allowCompleted) {
    throw new Error(
      'Stage 2 checkpoint is already completed. Start a new run, use the existing CSV output, or pass --retry-errors.',
    );
  }
}

export function errorRowIndices(rows: Stage2Row[]): number[] {
  return rows
    .map((row, index) => (row.extraction_status === 'error' ? index : -1))
    .filter((index) => index >= 0);
}

function resolvePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function persistCheckpointState(
  runDir: string,
  checkpoint: Stage2Checkpoint,
  rows: Stage2Row[],
  csvOutputPath?: string,
): void {
  mkdirSync(runDir, { recursive: true });
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.rows = rows;
  checkpoint.stats = computeStage2Stats(rows);
  writeFileSync(checkpointPath(runDir), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  writeCsv(csvOutputPath ?? checkpoint.output_path, rows, STAGE2_COLUMNS);
}

export function appendExtractionLog(runDir: string, entry: ExtractionLogEntry): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(extractionLogPath(runDir), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function fingerprintFromInput(inputPath: string, maxRows: number | null, rows: Stage1Row[]): Stage2Checkpoint['input_fingerprint'] {
  const limited = maxRows != null && maxRows > 0 ? rows.slice(0, maxRows) : rows;
  return inputFingerprint(
    inputPath,
    maxRows,
    limited.map((r) => r.result_url),
  );
}
