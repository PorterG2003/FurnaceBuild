import type { SupabaseClient } from '@supabase/supabase-js';

export const WEBSITE_VERIFICATION_BATCH_SIZE_DEFAULT = 25;
export const WEBSITE_VERIFICATION_BATCH_SIZE_MIN = 10;
export const WEBSITE_VERIFICATION_BATCH_SIZE_MAX = 50;
export const WEBSITE_VERIFICATION_MAP_MAX_CONCURRENCY_DEFAULT = 4;
export const WEBSITE_VERIFICATION_MAP_MAX_CONCURRENCY_MIN = 1;
export const WEBSITE_VERIFICATION_MAP_MAX_CONCURRENCY_MAX = 10;

export interface WebsiteVerificationProgressCounts {
  companies_processed: number;
  companies_with_result: number;
  outcome_usable: number;
  outcome_uncertain: number;
  outcome_not_usable: number;
  outcome_error: number;
}

export interface WebsiteVerificationJobPayloadMeta {
  in_scope_total: number;
  skipped_total: number;
  batch_size: number | null;
  batch_count: number | null;
  max_concurrency: number | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export function websiteVerificationJobPayloadMeta(payload: Record<string, unknown> | null | undefined): WebsiteVerificationJobPayloadMeta {
  const p = payload ?? {};
  const preflight = p.preflight && typeof p.preflight === 'object' ? (p.preflight as Record<string, unknown>) : {};
  const ready = asStringArray(preflight.ready);
  const missingWebsite = asStringArray(preflight.missing_website);
  const readyCompanyIds = asStringArray(p.ready_company_ids);
  const companyIds = asStringArray(p.company_ids);
  const inScopeTotal = ready.length || readyCompanyIds.length || companyIds.length;
  const skippedTotal = missingWebsite.length;
  return {
    in_scope_total: inScopeTotal,
    skipped_total: skippedTotal,
    batch_size: Number.isFinite(Number(p.batch_size)) ? Math.max(1, Math.trunc(Number(p.batch_size))) : null,
    batch_count: Number.isFinite(Number(p.batch_count)) ? Math.max(1, Math.trunc(Number(p.batch_count))) : null,
    max_concurrency: Number.isFinite(Number(p.map_max_concurrency))
      ? Math.max(1, Math.trunc(Number(p.map_max_concurrency)))
      : null,
  };
}

export async function loadWebsiteVerificationProgressCounts(
  leadsClient: SupabaseClient,
  jobId: string,
): Promise<WebsiteVerificationProgressCounts> {
  const { data, error } = await leadsClient
    .rpc('get_website_verification_job_progress', { p_job_id: jobId })
    .single();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  const companiesProcessed = Math.max(0, Math.trunc(Number(row.companies_processed ?? 0) || 0));
  return {
    companies_processed: companiesProcessed,
    companies_with_result: companiesProcessed,
    outcome_usable: Math.max(0, Math.trunc(Number(row.outcome_usable ?? 0) || 0)),
    outcome_uncertain: Math.max(0, Math.trunc(Number(row.outcome_uncertain ?? 0) || 0)),
    outcome_not_usable: Math.max(0, Math.trunc(Number(row.outcome_not_usable ?? 0) || 0)),
    outcome_error: Math.max(0, Math.trunc(Number(row.outcome_error ?? 0) || 0)),
  };
}

export function buildWebsiteVerificationProgressSnapshot(
  payload: Record<string, unknown> | null | undefined,
  counts: WebsiteVerificationProgressCounts,
  opts?: {
    current_step?: string | null;
    previous?: Record<string, unknown> | null | undefined;
    refreshed_at?: string;
  },
): Record<string, unknown> {
  const previous = opts?.previous ?? {};
  const meta = websiteVerificationJobPayloadMeta(payload);
  return {
    ...previous,
    current_step: opts?.current_step ?? previous.current_step ?? 'running',
    in_scope_total: meta.in_scope_total,
    not_applicable_count: meta.skipped_total,
    companies_processed: counts.companies_processed,
    companies_with_result: counts.companies_with_result,
    outcome_usable: counts.outcome_usable,
    outcome_uncertain: counts.outcome_uncertain,
    outcome_not_usable: counts.outcome_not_usable,
    outcome_error: counts.outcome_error,
    outcome_skipped: meta.skipped_total,
    batch_size: meta.batch_size,
    batches_total: meta.batch_count,
    max_concurrency: meta.max_concurrency,
    last_progress_refresh_at: opts?.refreshed_at ?? new Date().toISOString(),
  };
}
