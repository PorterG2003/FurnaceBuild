import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeWebsiteUrl, normalizeGoogleAdsSearchDomain } from './searchDomain.js';
import type { WebsiteVerificationBand } from './websiteVerification.js';

export const GOOGLE_ADS_VERIFIER_VERSION = 'foundry_google_ads_verifier_v1';
export const GOOGLE_ADS_VERIFICATION_RESULTS = ['yes', 'no', 'unknown'] as const;
export type GoogleAdsVerificationResult = (typeof GOOGLE_ADS_VERIFICATION_RESULTS)[number];

type JsonObject = Record<string, unknown>;

interface GoogleAdsVerificationCompanyRow {
  id: string;
  legal_name: string;
}

interface GoogleAdsVerificationWebsiteRow {
  id: string;
  company_id: string;
  input_url: string;
  final_url: string | null;
  band: WebsiteVerificationBand | null;
  verified_at: string;
  verifier_version: string;
}

export interface GoogleAdsVerificationTarget {
  company_id: string;
  legal_name: string;
  website_verification_id: string | null;
  verified_input_url: string | null;
  verified_final_url: string | null;
  website_verification_band: WebsiteVerificationBand | null;
  website_verification_verified_at: string | null;
  website_verifier_version: string | null;
}

export interface GoogleAdsVerificationLookupMatch {
  advertiser_id?: string | null;
  advertiser_name?: string | null;
  advertiser_url?: string | null;
}

export interface GoogleAdsVerificationInsertRow {
  company_id: string;
  website_verification_id?: string | null;
  foundry_job_id?: string | null;
  source_ingestion_run_id?: string | null;
  input_url: string;
  search_domain: string;
  result?: GoogleAdsVerificationResult | null;
  matched_advertiser_id?: string | null;
  matched_advertiser_name?: string | null;
  advertiser_url?: string | null;
  latest_ad_last_shown_at?: string | null;
  signals?: JsonObject;
  error?: string | null;
  verifier_version: string;
  lookup_stats?: JsonObject;
  verified_at?: string;
}

function supabaseQueryErrorMessage(
  ctx: string,
  err: { message: string; details?: string | null; hint?: string | null; code?: string | null },
): string {
  const bits = [err.message, err.details, err.hint, err.code].filter(
    (x) => x != null && String(x).trim() !== '',
  );
  if (bits.length > 0) return `${ctx}: ${bits.join(' | ')}`;
  try {
    return `${ctx}: ${JSON.stringify(err)}`;
  } catch {
    return `${ctx}: unknown Supabase error`;
  }
}

const GOOGLE_ADS_ID_IN_BATCH = 120;

async function selectByIdBatches(
  leadsClient: SupabaseClient,
  ctxLabel: string,
  ids: string[],
  fetchBatch: (batch: string[]) => Promise<{
    data: unknown[] | null;
    error: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null;
  }>,
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += GOOGLE_ADS_ID_IN_BATCH) {
    const batch = ids.slice(i, i + GOOGLE_ADS_ID_IN_BATCH);
    const { data, error } = await fetchBatch(batch);
    if (error) throw new Error(supabaseQueryErrorMessage(ctxLabel, error));
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return out;
}

export { normalizeGoogleAdsSearchDomain } from './searchDomain.js';

export async function loadGoogleAdsVerificationTargets(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<GoogleAdsVerificationTarget[]> {
  const uniqueCompanyIds = [...new Set(companyIds.filter(Boolean))];
  if (uniqueCompanyIds.length === 0) return [];

  const companies = (await selectByIdBatches(
    leadsClient,
    'loadGoogleAdsVerificationTargets companies',
    uniqueCompanyIds,
    async (batch) => await leadsClient.from('companies').select('id, legal_name').in('id', batch),
  )) as unknown as GoogleAdsVerificationCompanyRow[];

  const websiteRows = (await selectByIdBatches(
    leadsClient,
    'loadGoogleAdsVerificationTargets company_website_verifications',
    uniqueCompanyIds,
    async (batch) =>
      await leadsClient
        .from('company_website_verifications')
        .select('id, company_id, input_url, final_url, band, verified_at, verifier_version')
        .in('company_id', batch)
        .order('verified_at', { ascending: false }),
  )) as unknown as GoogleAdsVerificationWebsiteRow[];

  const latestByCompanyId = new Map<string, GoogleAdsVerificationWebsiteRow>();
  for (const row of websiteRows) {
    if (!row?.company_id || latestByCompanyId.has(row.company_id)) continue;
    latestByCompanyId.set(row.company_id, row);
  }

  const companyMap = new Map(companies.map((company) => [company.id, company]));
  return uniqueCompanyIds.map((companyId) => {
    const company = companyMap.get(companyId);
    const latest = latestByCompanyId.get(companyId);
    return {
      company_id: companyId,
      legal_name: company?.legal_name ?? '',
      website_verification_id: latest?.id ?? null,
      verified_input_url: latest?.input_url ?? null,
      verified_final_url: latest?.final_url ?? null,
      website_verification_band: latest?.band ?? null,
      website_verification_verified_at: latest?.verified_at ?? null,
      website_verifier_version: latest?.verifier_version ?? null,
    };
  });
}

export function pickGoogleAdsVerificationTarget(
  target: GoogleAdsVerificationTarget,
): { input_url: string; search_domain: string } | null {
  if (target.website_verification_band !== 'usable') return null;
  const preferredUrl = target.verified_final_url ?? target.verified_input_url;
  const inputUrl = canonicalizeWebsiteUrl(preferredUrl);
  const searchDomain = normalizeGoogleAdsSearchDomain(preferredUrl);
  if (!inputUrl || !searchDomain) return null;
  return {
    input_url: inputUrl,
    search_domain: searchDomain,
  };
}

export function countGoogleAdsVerificationResults(
  rows: Array<{ result: string | null; error?: string | null }>,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (typeof row.error === 'string' && row.error.trim()) {
      acc.error = (acc.error ?? 0) + 1;
      return acc;
    }
    const result = typeof row.result === 'string' ? row.result : '';
    if (result === 'yes' || result === 'no' || result === 'unknown') {
      acc[result] = (acc[result] ?? 0) + 1;
    }
    return acc;
  }, {});
}
