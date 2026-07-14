import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApifyActorKind } from './apifyMetaAdsClient.js';

export const APIFY_BATCH_CHECKPOINT_KIND = 'meta_ads_apify_pilot_batch' as const;
export const APIFY_BATCH_CHECKPOINT_VERSION = 1 as const;

export type ApifyBatchMode = 'pilot' | 'all';

export interface ApifyBatchCheckpointArgs {
  csvPath: string;
  outDir: string;
  batchMode: ApifyBatchMode;
  maxRows: number | null;
  actor: ApifyActorKind;
  webinarScanDays: number;
}

export interface ApifyBatchCheckpointError {
  company_domain: string;
  company_name: string;
  error: string;
  at: string;
}

export interface ApifyBatchCheckpoint {
  kind: typeof APIFY_BATCH_CHECKPOINT_KIND;
  version: typeof APIFY_BATCH_CHECKPOINT_VERSION;
  createdAt: string;
  updatedAt: string;
  args: ApifyBatchCheckpointArgs;
  completedDomains: string[];
  results: Record<string, unknown>[];
  errors: ApifyBatchCheckpointError[];
}

export function createEmptyApifyCheckpoint(args: ApifyBatchCheckpointArgs): ApifyBatchCheckpoint {
  const now = new Date().toISOString();
  return {
    kind: APIFY_BATCH_CHECKPOINT_KIND,
    version: APIFY_BATCH_CHECKPOINT_VERSION,
    createdAt: now,
    updatedAt: now,
    args,
    completedDomains: [],
    results: [],
    errors: [],
  };
}

export function apifyCheckpointArgsMatch(checkpoint: ApifyBatchCheckpoint, args: ApifyBatchCheckpointArgs): void {
  if (checkpoint.kind !== APIFY_BATCH_CHECKPOINT_KIND || checkpoint.version !== APIFY_BATCH_CHECKPOINT_VERSION) {
    throw new Error('Checkpoint is not an Apify meta ads pilot batch checkpoint.');
  }
  const mismatches: string[] = [];
  if (checkpoint.args.csvPath !== args.csvPath) mismatches.push('csvPath');
  if (checkpoint.args.outDir !== args.outDir) mismatches.push('outDir');
  if ((checkpoint.args.batchMode ?? 'pilot') !== args.batchMode) mismatches.push('batchMode');
  if ((checkpoint.args.maxRows ?? null) !== args.maxRows) mismatches.push('maxRows');
  if (checkpoint.args.actor !== args.actor) mismatches.push('actor');
  if (checkpoint.args.webinarScanDays !== args.webinarScanDays) mismatches.push('webinarScanDays');
  if (mismatches.length > 0) {
    throw new Error(`Checkpoint args mismatch: ${mismatches.join(', ')}`);
  }
}

export function loadApifyCheckpoint(path: string): ApifyBatchCheckpoint | null {
  if (!existsSync(path)) return null;
  const checkpoint = JSON.parse(readFileSync(path, 'utf8')) as ApifyBatchCheckpoint;
  if (checkpoint.kind !== APIFY_BATCH_CHECKPOINT_KIND || checkpoint.version !== APIFY_BATCH_CHECKPOINT_VERSION) {
    throw new Error(`Checkpoint ${path} is not an Apify meta ads pilot batch checkpoint.`);
  }
  return checkpoint;
}

export function saveApifyCheckpoint(path: string, checkpoint: ApifyBatchCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2),
  );
}

export function markApifyCheckpointCompleted(
  checkpoint: ApifyBatchCheckpoint,
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

export function recordApifyCheckpointError(
  checkpoint: ApifyBatchCheckpoint,
  entry: Omit<ApifyBatchCheckpointError, 'at'>,
): void {
  checkpoint.errors.push({ ...entry, at: new Date().toISOString() });
}

/** Remove domains from completedDomains + results (used for health-halt streak rollback). */
export function unmarkApifyCheckpointDomains(
  checkpoint: ApifyBatchCheckpoint,
  domains: string[],
): number {
  const remove = new Set(domains.map((d) => d.trim()).filter(Boolean));
  if (remove.size === 0) return 0;
  const before = checkpoint.completedDomains.length;
  checkpoint.completedDomains = checkpoint.completedDomains.filter((d) => !remove.has(d));
  checkpoint.results = checkpoint.results.filter(
    (row) => !remove.has((row.company_domain as string | undefined)?.trim() ?? ''),
  );
  return before - checkpoint.completedDomains.length;
}
