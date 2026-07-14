import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const BATCH_CHECKPOINT_KIND = 'meta_ads_webinar_batch' as const;
export const BATCH_CHECKPOINT_VERSION = 1 as const;

export type MetaAdsBatchMode = 'sample' | 'all';

export interface MetaAdsBatchAntiBotConfig {
  delayMinMs: number;
  delayMaxMs: number;
  retryNoResults: boolean;
  maxNoResultRetries: number;
  retryMinMs: number;
  retryMaxMs: number;
  rotateSessionEvery: number;
}

export interface MetaAdsBatchCheckpointArgs {
  csvPath: string;
  outDir: string;
  headless: boolean;
  scanWebinars: boolean;
  webinarScanDays: number;
  batchMode: MetaAdsBatchMode;
  maxRows: number | null;
  sampleNames: string[];
  pilot?: boolean;
  antiBot?: MetaAdsBatchAntiBotConfig;
}

export interface MetaAdsBatchCheckpointError {
  company_domain: string;
  company_name: string;
  error: string;
  at: string;
}

export interface MetaAdsBatchCheckpoint {
  kind: typeof BATCH_CHECKPOINT_KIND;
  version: typeof BATCH_CHECKPOINT_VERSION;
  createdAt: string;
  updatedAt: string;
  args: MetaAdsBatchCheckpointArgs;
  completedDomains: string[];
  results: Record<string, unknown>[];
  errors: MetaAdsBatchCheckpointError[];
}

export function createEmptyCheckpoint(args: MetaAdsBatchCheckpointArgs): MetaAdsBatchCheckpoint {
  const now = new Date().toISOString();
  return {
    kind: BATCH_CHECKPOINT_KIND,
    version: BATCH_CHECKPOINT_VERSION,
    createdAt: now,
    updatedAt: now,
    args,
    completedDomains: [],
    results: [],
    errors: [],
  };
}

function sortedSampleNames(names: string[]): string[] {
  return [...names].sort();
}

export function checkpointArgsMatch(
  checkpoint: MetaAdsBatchCheckpoint,
  args: MetaAdsBatchCheckpointArgs,
): void {
  if (checkpoint.kind !== BATCH_CHECKPOINT_KIND || checkpoint.version !== BATCH_CHECKPOINT_VERSION) {
    throw new Error('Checkpoint is not a meta ads webinar batch checkpoint.');
  }
  const mismatches: string[] = [];
  if (checkpoint.args.csvPath !== args.csvPath) mismatches.push('csvPath');
  if (checkpoint.args.outDir !== args.outDir) mismatches.push('outDir');
  // headless only affects browser visibility, not scrape semantics — allow resume either way
  if (checkpoint.args.scanWebinars !== args.scanWebinars) mismatches.push('scanWebinars');
  if (checkpoint.args.webinarScanDays !== args.webinarScanDays) mismatches.push('webinarScanDays');
  if ((checkpoint.args.batchMode ?? 'sample') !== args.batchMode) mismatches.push('batchMode');
  if ((checkpoint.args.maxRows ?? null) !== args.maxRows) mismatches.push('maxRows');
  if ((checkpoint.args.pilot ?? false) !== (args.pilot ?? false)) mismatches.push('pilot');
  if (args.antiBot && checkpoint.args.antiBot) {
    if (JSON.stringify(checkpoint.args.antiBot) !== JSON.stringify(args.antiBot)) {
      mismatches.push('antiBot');
    }
  }
  if (args.batchMode === 'sample') {
    const a = sortedSampleNames(checkpoint.args.sampleNames);
    const b = sortedSampleNames(args.sampleNames);
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push('sampleNames');
  }
  if (mismatches.length > 0) {
    throw new Error(`Checkpoint args mismatch: ${mismatches.join(', ')}`);
  }
}

export function loadCheckpoint(path: string): MetaAdsBatchCheckpoint | null {
  if (!existsSync(path)) return null;
  const checkpoint = JSON.parse(readFileSync(path, 'utf8')) as MetaAdsBatchCheckpoint;
  if (checkpoint.kind !== BATCH_CHECKPOINT_KIND || checkpoint.version !== BATCH_CHECKPOINT_VERSION) {
    throw new Error(`Checkpoint ${path} is not a meta ads webinar batch checkpoint.`);
  }
  return checkpoint;
}

export function saveCheckpoint(path: string, checkpoint: MetaAdsBatchCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2),
  );
}

export function markCheckpointCompleted(
  checkpoint: MetaAdsBatchCheckpoint,
  domain: string,
  result: Record<string, unknown>,
): void {
  if (!checkpoint.completedDomains.includes(domain)) {
    checkpoint.completedDomains.push(domain);
  }
  const index = checkpoint.results.findIndex(
    (row) => (row.company_domain as string | undefined) === domain,
  );
  if (index >= 0) checkpoint.results[index] = result;
  else checkpoint.results.push(result);
}

export function recordCheckpointError(
  checkpoint: MetaAdsBatchCheckpoint,
  entry: Omit<MetaAdsBatchCheckpointError, 'at'>,
): void {
  checkpoint.errors.push({ ...entry, at: new Date().toISOString() });
}
