import { createHash, randomBytes } from 'node:crypto';
import type { ApiBulkExclusions, ApiBulkScope } from './scope.js';

export type BulkPreviewCounts = {
  matched: number;
  excluded: number;
  duplicate: number;
  ineligible: number;
  actionable: number;
};

export type BulkPreviewResult = {
  preview_id: string;
  operation: string;
  operation_hash: string;
  expires_at: string;
  counts: BulkPreviewCounts;
  warnings: string[];
  scope: ApiBulkScope;
  exclusions: ApiBulkExclusions | null;
  target?: Record<string, unknown>;
};

export const BULK_PREVIEW_TTL_MS = 15 * 60 * 1000;

export function createPreviewId(): string {
  return `bp_${randomBytes(16).toString('hex')}`;
}

export function hashBulkOperation(input: {
  operation: string;
  accountId: string;
  scope: ApiBulkScope;
  exclusions?: ApiBulkExclusions | null;
  target?: Record<string, unknown> | null;
}): string {
  const payload = JSON.stringify({
    operation: input.operation,
    accountId: input.accountId,
    scope: input.scope,
    exclusions: input.exclusions ?? null,
    target: input.target ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function previewExpiresAt(now = Date.now()): string {
  return new Date(now + BULK_PREVIEW_TTL_MS).toISOString();
}

export function emptyPreviewCounts(): BulkPreviewCounts {
  return {
    matched: 0,
    excluded: 0,
    duplicate: 0,
    ineligible: 0,
    actionable: 0,
  };
}
