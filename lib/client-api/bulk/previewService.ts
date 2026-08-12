import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types/supabase-client-database.js';
import type { Json } from '../../supabase/types/database.js';
import { invalidRequest } from '../errors.js';
import {
  createPreviewId,
  emptyPreviewCounts,
  hashBulkOperation,
  previewExpiresAt,
  BULK_PREVIEW_TTL_MS,
  type BulkPreviewCounts,
  type BulkPreviewResult,
} from './preview.js';
import {
  normalizeStringIds,
  parseApiBulkExclusions,
  parseApiBulkScope,
  type ApiBulkExclusions,
  type ApiBulkScope,
} from './scope.js';

type Supabase = SupabaseClient<Database>;

export type PreviewBulkBody = {
  operation?: string;
  campaign_id?: string | null;
  target_list_id?: string | null;
  list_id?: string | null;
  scope?: unknown;
  exclusions?: unknown;
  global_lead_ids?: string[];
};

function previewSigningSecret(): string {
  return (
    process.env.CLIENT_API_PREVIEW_SIGNING_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    'furnace-bulk-preview-dev-secret'
  );
}

function signPreviewToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', previewSigningSecret()).update(body).digest('base64url');
  return `bpt_${body}.${sig}`;
}

function verifyPreviewToken(token: string): Record<string, unknown> | null {
  if (!token.startsWith('bpt_')) return null;
  const raw = token.slice(4);
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', previewSigningSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function countSavedListMembers(
  supabase: Supabase,
  accountId: string,
  listId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('lead_saved_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('list_id', listId);
  if (error) throw new Error(`Failed to count list members: ${error.message}`);
  return count ?? 0;
}

async function countCampaignPeople(
  supabase: Supabase,
  accountId: string,
  campaignId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .not('global_lead_id', 'is', null);
  if (error) throw new Error(`Failed to count campaign people: ${error.message}`);
  return count ?? 0;
}

async function resolveMatchedCount(
  supabase: Supabase,
  accountId: string,
  scope: ApiBulkScope,
): Promise<number> {
  switch (scope.kind) {
    case 'selection':
      return scope.global_lead_ids.length;
    case 'saved_list':
    case 'saved_list_filtered':
      return countSavedListMembers(supabase, accountId, scope.list_id);
    case 'campaign':
      return countCampaignPeople(supabase, accountId, scope.campaign_id);
    case 'explorer_view':
      return 0;
    case 'staged_upload': {
      const { count, error } = await supabase
        .from('csv_import_staging')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('job_id', scope.upload_id);
      if (error) throw new Error(`Failed to count staged rows: ${error.message}`);
      return count ?? 0;
    }
    default:
      return 0;
  }
}

async function resolveExcludedCount(
  supabase: Supabase,
  accountId: string,
  exclusions: ApiBulkExclusions | null,
): Promise<number> {
  if (!exclusions) return 0;
  let excluded = 0;
  if (exclusions.list_id) {
    excluded += await countSavedListMembers(supabase, accountId, exclusions.list_id);
  }
  if (exclusions.campaign_id) {
    excluded += await countCampaignPeople(supabase, accountId, exclusions.campaign_id);
  }
  excluded += exclusions.global_lead_ids?.length ?? 0;
  excluded += exclusions.emails?.length ?? 0;
  return excluded;
}

export async function createBulkOperationPreview(
  supabase: Supabase,
  accountId: string,
  body: PreviewBulkBody,
): Promise<BulkPreviewResult> {
  const operation = body.operation?.trim();
  if (!operation) invalidRequest('missing_operation', 'operation is required', 'operation');

  const scope =
    parseApiBulkScope(body.scope) ??
    (body.list_id
      ? { kind: 'saved_list' as const, list_id: body.list_id }
      : body.global_lead_ids?.length
        ? { kind: 'selection' as const, global_lead_ids: normalizeStringIds(body.global_lead_ids) }
        : null);
  if (!scope) invalidRequest('missing_scope', 'scope, list_id, or global_lead_ids is required', 'scope');

  const exclusions = parseApiBulkExclusions(body.exclusions);
  const warnings: string[] = [];
  if (scope.kind === 'explorer_view') {
    warnings.push('explorer_view preview counts are approximate until execution resolves filters.');
  }

  const matched = await resolveMatchedCount(supabase, accountId, scope);
  const excluded = await resolveExcludedCount(supabase, accountId, exclusions);
  const actionable = Math.max(matched - excluded, 0);
  const counts: BulkPreviewCounts = {
    ...emptyPreviewCounts(),
    matched,
    excluded,
    actionable,
  };

  const target: Record<string, unknown> = {};
  if (body.campaign_id) target.campaign_id = body.campaign_id;
  if (body.target_list_id || body.list_id) {
    target.list_id = body.target_list_id ?? body.list_id;
  }

  const previewId = createPreviewId();
  const operationHash = hashBulkOperation({
    operation,
    accountId,
    scope,
    exclusions,
    target,
  });
  const expiresAt = previewExpiresAt();

  // Signed token is the source of truth for binding (works before/without migration).
  const signedPreviewId = signPreviewToken({
    preview_id: previewId,
    account_id: accountId,
    operation,
    operation_hash: operationHash,
    expires_at: expiresAt,
  });

  // Best-effort durable store when migration is present.
  await supabase.from('api_bulk_operation_previews' as never).insert({
    id: previewId,
    account_id: accountId,
    operation,
    operation_hash: operationHash,
    scope: scope as unknown as Json,
    exclusions: (exclusions ?? null) as unknown as Json,
    target: target as unknown as Json,
    counts: counts as unknown as Json,
    warnings: warnings as unknown as Json,
    expires_at: expiresAt,
  } as never);

  return {
    preview_id: signedPreviewId,
    operation,
    operation_hash: operationHash,
    expires_at: expiresAt,
    counts,
    warnings,
    scope,
    exclusions,
    target,
  };
}

export async function assertPreviewBinding(
  _supabase: Supabase,
  accountId: string,
  previewId: string | null | undefined,
  input: {
    operation: string;
    scope: ApiBulkScope | null;
    exclusions: ApiBulkExclusions | null;
    target?: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!previewId) return;
  const payload = verifyPreviewToken(previewId);
  if (!payload) {
    invalidRequest('invalid_preview', 'Bulk operation preview token is invalid', 'preview_id');
  }
  if (payload.account_id !== accountId) {
    invalidRequest('preview_account_mismatch', 'Bulk preview belongs to another account', 'preview_id');
  }
  const expiresAt = typeof payload.expires_at === 'string' ? Date.parse(payload.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() - 5_000) {
    invalidRequest('preview_expired', 'Bulk operation preview has expired', 'preview_id');
  }
  // Keep TTL meaningful even if clock skew.
  if (expiresAt > Date.now() + BULK_PREVIEW_TTL_MS + 60_000) {
    invalidRequest('invalid_preview', 'Bulk operation preview token is invalid', 'preview_id');
  }
  if (!input.scope) {
    invalidRequest('missing_scope', 'scope is required when binding a preview', 'scope');
  }
  const hash = hashBulkOperation({
    operation: input.operation,
    accountId,
    scope: input.scope,
    exclusions: input.exclusions,
    target: input.target ?? null,
  });
  if (hash !== payload.operation_hash || payload.operation !== input.operation) {
    invalidRequest(
      'preview_mismatch',
      'Execution payload does not match the confirmed bulk preview',
      'preview_id',
    );
  }
}
