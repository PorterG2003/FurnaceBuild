import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { countGoogleAdsVerificationResults } from '@furnace/registry-server';

let cachedClient: SupabaseClient | null = null;

function getLeadsClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.LEADS_SUPABASE_URL;
  const key = process.env.LEADS_SUPABASE_SECRET_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

type FinalizeEvent = { action: 'finalize'; jobId: string };
type FailEvent = { action: 'fail'; jobId: string; message?: string };

export const handler = async (event: FinalizeEvent | FailEvent): Promise<Record<string, unknown>> => {
  const client = getLeadsClient();
  if (event.action === 'finalize') {
    const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as Record<string, unknown>;
    const { data: rows, error } = await client
      .from('company_google_ads_verifications')
      .select('result, error')
      .eq('foundry_job_id', event.jobId);
    if (error) throw new Error(error.message);
    const counts = countGoogleAdsVerificationResults(
      (rows ?? []) as Array<{ result: string | null; error?: string | null }>,
    );
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: {
          ...prev,
          current_step: 'done',
          outcome_yes: counts.yes,
          outcome_no: counts.no,
          outcome_unknown: counts.unknown,
          outcome_error: counts.error,
          companies_with_result: (rows ?? []).length,
        },
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  const message = typeof event.message === 'string' && event.message.trim() ? event.message.trim() : 'Step Functions failure';
  await client
    .from('foundry_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_summary: message,
    })
    .eq('id', event.jobId);
  return { ok: true };
};
