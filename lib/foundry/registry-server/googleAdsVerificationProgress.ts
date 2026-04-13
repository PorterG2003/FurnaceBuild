import type { SupabaseClient } from '@supabase/supabase-js';
import { countGoogleAdsVerificationResults } from './googleAdsVerification.js';

export interface GoogleAdsVerificationProgressCounts {
  companies_processed: number;
  companies_with_result: number;
  outcome_yes: number;
  outcome_no: number;
  outcome_unknown: number;
  outcome_error: number;
}

export interface GoogleAdsVerificationJobPayloadMeta {
  in_scope_total: number;
  skipped_total: number;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export function googleAdsVerificationJobPayloadMeta(
  payload: Record<string, unknown> | null | undefined,
): GoogleAdsVerificationJobPayloadMeta {
  const p = payload ?? {};
  const preflight = p.preflight && typeof p.preflight === 'object' ? (p.preflight as Record<string, unknown>) : {};
  const ready = asStringArray(preflight.ready);
  const missingVerifiedWebsite = asStringArray(preflight.missing_verified_website);
  const readyCompanyIds = asStringArray(p.ready_company_ids);
  const companyIds = asStringArray(p.company_ids);
  const inScopeTotal = ready.length || readyCompanyIds.length || companyIds.length;
  return {
    in_scope_total: inScopeTotal,
    skipped_total: missingVerifiedWebsite.length,
  };
}

export async function loadGoogleAdsVerificationProgressCounts(
  leadsClient: SupabaseClient,
  jobId: string,
): Promise<GoogleAdsVerificationProgressCounts> {
  const { data, error } = await leadsClient
    .from('company_google_ads_verifications')
    .select('result, error')
    .eq('foundry_job_id', jobId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ result: string | null; error?: string | null }>;
  const counts = countGoogleAdsVerificationResults(rows);
  const companiesProcessed = rows.length;
  return {
    companies_processed: companiesProcessed,
    companies_with_result: companiesProcessed,
    outcome_yes: Math.max(0, Math.trunc(Number(counts.yes ?? 0) || 0)),
    outcome_no: Math.max(0, Math.trunc(Number(counts.no ?? 0) || 0)),
    outcome_unknown: Math.max(0, Math.trunc(Number(counts.unknown ?? 0) || 0)),
    outcome_error: Math.max(0, Math.trunc(Number(counts.error ?? 0) || 0)),
  };
}

export function buildGoogleAdsVerificationProgressSnapshot(
  payload: Record<string, unknown> | null | undefined,
  counts: GoogleAdsVerificationProgressCounts,
  opts?: {
    current_step?: string | null;
    previous?: Record<string, unknown> | null | undefined;
    refreshed_at?: string;
  },
): Record<string, unknown> {
  const previous = opts?.previous ?? {};
  const meta = googleAdsVerificationJobPayloadMeta(payload);
  return {
    ...previous,
    current_step: opts?.current_step ?? previous.current_step ?? 'running',
    in_scope_total: meta.in_scope_total,
    not_applicable_count: meta.skipped_total,
    companies_processed: counts.companies_processed,
    companies_with_result: counts.companies_with_result,
    outcome_yes: counts.outcome_yes,
    outcome_no: counts.outcome_no,
    outcome_unknown: counts.outcome_unknown,
    outcome_error: counts.outcome_error,
    outcome_skipped: meta.skipped_total,
    last_progress_refresh_at: opts?.refreshed_at ?? new Date().toISOString(),
  };
}
