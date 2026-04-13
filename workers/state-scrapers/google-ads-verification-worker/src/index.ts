import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createClient } from '@supabase/supabase-js';
import {
  GOOGLE_ADS_VERIFIER_VERSION,
  countGoogleAdsVerificationResults,
  loadGoogleAdsVerificationTargets,
  pickGoogleAdsVerificationTarget,
} from '@furnace/registry-server';
import { runGoogleAdsTransparencyLookup } from './transparencyLookup.js';

type JobProgress = Record<string, unknown> & {
  in_scope_total?: number;
  companies_processed?: number;
  outcome_yes?: number;
  outcome_no?: number;
  outcome_unknown?: number;
  outcome_error?: number;
  outcome_skipped?: number;
  companies_with_result?: number;
  current_step?: string;
};

function logEvent(event: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: 'google-ads-verification', event, at: new Date().toISOString(), ...data }));
}

async function fetchSecretFromParameterStore(parameterPath: string, region: string): Promise<string> {
  const ssmClient = new SSMClient({ region });
  const response = await ssmClient.send(new GetParameterCommand({ Name: parameterPath, WithDecryption: true }));
  if (!response.Parameter?.Value?.trim()) {
    throw new Error(`Parameter ${parameterPath} has no value`);
  }
  return response.Parameter.Value.trim();
}

async function loadSecret(): Promise<{ url: string; key: string; jobId: string }> {
  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const jobId = process.env.JOB_ID?.trim();
  let key = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  const paramPath = process.env.LEADS_SUPABASE_SECRET_KEY_PARAM_PATH?.trim();
  const region = process.env.AWS_REGION || 'us-west-2';
  if (!url || !jobId) {
    throw new Error('Missing LEADS_SUPABASE_URL or JOB_ID');
  }
  if (!key && paramPath) {
    key = await fetchSecretFromParameterStore(paramPath, region);
  }
  if (!key) {
    throw new Error('Missing LEADS_SUPABASE_SECRET_KEY or LEADS_SUPABASE_SECRET_KEY_PARAM_PATH');
  }
  return { url, key, jobId };
}

async function updateJobProgress(client: any, jobId: string, progress: JobProgress): Promise<void> {
  const { error } = await (client
    .from('foundry_jobs') as any)
    .update({ progress: { ...progress, current_step: 'running' } })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
}

async function main(): Promise<void> {
  const { url, key, jobId } = await loadSecret();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: jobRow, error: jobErr } = await client
    .from('foundry_jobs')
    .select('payload, progress')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    throw new Error(jobErr?.message || `Job ${jobId} not found`);
  }

  const payload = (jobRow.payload ?? {}) as Record<string, unknown>;
  const companyIds = Array.isArray(payload.company_ids)
    ? payload.company_ids.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const sourceIngestionRunId =
    typeof payload.source_ingestion_run_id === 'string' && payload.source_ingestion_run_id.trim().length > 0
      ? payload.source_ingestion_run_id.trim()
      : null;
  const progress = ((jobRow.progress ?? {}) as JobProgress) || {};
  progress.in_scope_total = progress.in_scope_total ?? companyIds.length;
  progress.companies_processed = progress.companies_processed ?? 0;
  progress.outcome_yes = progress.outcome_yes ?? 0;
  progress.outcome_no = progress.outcome_no ?? 0;
  progress.outcome_unknown = progress.outcome_unknown ?? 0;
  progress.outcome_error = progress.outcome_error ?? 0;
  progress.outcome_skipped = progress.outcome_skipped ?? 0;
  progress.companies_with_result = progress.companies_with_result ?? 0;

  const targets = await loadGoogleAdsVerificationTargets(
    client as unknown as Parameters<typeof loadGoogleAdsVerificationTargets>[0],
    companyIds,
  );

  logEvent('worker-start', { jobId, companies: companyIds.length, sourceIngestionRunId });

  for (const target of targets) {
    const lookupTarget = pickGoogleAdsVerificationTarget(target);
    if (!lookupTarget) {
      logEvent('company-skipped', {
        jobId,
        companyId: target.company_id,
        legalName: target.legal_name,
        reason: 'missing_usable_website_verification',
      });
      progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
      progress.outcome_skipped = Number(progress.outcome_skipped ?? 0) + 1;
      await updateJobProgress(client, jobId, progress);
      continue;
    }

    try {
      const result = await runGoogleAdsTransparencyLookup({
        domain: lookupTarget.search_domain,
        headless: false,
        region: 'US',
        timeoutMs: 20_000,
      });
      logEvent('company-result', {
        jobId,
        companyId: target.company_id,
        legalName: target.legal_name,
        result: {
          status: result.result,
          advertiserId: result.matched_advertiser_id,
          advertiserName: result.matched_advertiser_name,
          error: result.error ?? null,
        },
      });
      const { error } = await (client.from('company_google_ads_verifications') as any).insert({
        company_id: target.company_id,
        website_verification_id: target.website_verification_id,
        foundry_job_id: jobId,
        source_ingestion_run_id: sourceIngestionRunId,
        input_url: lookupTarget.input_url,
        search_domain: lookupTarget.search_domain,
        result: result.result,
        matched_advertiser_id: result.matched_advertiser_id,
        matched_advertiser_name: result.matched_advertiser_name,
        advertiser_url: result.advertiser_url,
        signals: result.signals,
        error: result.error ?? null,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: result.lookup_stats,
        verified_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
      progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
      if (result.result === 'yes') progress.outcome_yes = Number(progress.outcome_yes ?? 0) + 1;
      if (result.result === 'no') progress.outcome_no = Number(progress.outcome_no ?? 0) + 1;
      if (result.result === 'unknown' && !result.error) {
        progress.outcome_unknown = Number(progress.outcome_unknown ?? 0) + 1;
      }
      if (result.error) progress.outcome_error = Number(progress.outcome_error ?? 0) + 1;
      await updateJobProgress(client, jobId, progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await (client.from('company_google_ads_verifications') as any).insert({
        company_id: target.company_id,
        website_verification_id: target.website_verification_id,
        foundry_job_id: jobId,
        source_ingestion_run_id: sourceIngestionRunId,
        input_url: lookupTarget.input_url,
        search_domain: lookupTarget.search_domain,
        result: 'unknown',
        matched_advertiser_id: null,
        matched_advertiser_name: null,
        advertiser_url: null,
        signals: { search_domain: lookupTarget.search_domain },
        error: message,
        verifier_version: GOOGLE_ADS_VERIFIER_VERSION,
        lookup_stats: { final_url: null },
        verified_at: new Date().toISOString(),
      });
      progress.companies_processed = Number(progress.companies_processed ?? 0) + 1;
      progress.companies_with_result = Number(progress.companies_with_result ?? 0) + 1;
      progress.outcome_error = Number(progress.outcome_error ?? 0) + 1;
      await updateJobProgress(client, jobId, progress);
    }
  }

  const { data: rows, error: rowsErr } = await (client
    .from('company_google_ads_verifications') as any)
    .select('result, error')
    .eq('foundry_job_id', jobId);
  if (rowsErr) throw new Error(rowsErr.message);
  const counts = countGoogleAdsVerificationResults((rows ?? []) as Array<{ result: string | null; error?: string | null }>);
  await updateJobProgress(client, jobId, {
    ...progress,
    outcome_yes: counts.yes,
    outcome_no: counts.no,
    outcome_unknown: counts.unknown,
    outcome_error: counts.error,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
