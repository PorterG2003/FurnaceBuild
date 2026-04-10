import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function countBands(rows: Array<{ band: string | null; error?: string | null }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (typeof row.error === 'string' && row.error.trim()) {
      acc.error = (acc.error ?? 0) + 1;
      return acc;
    }
    const band = typeof row.band === 'string' ? row.band : '';
    if (band === 'usable' || band === 'uncertain' || band === 'not_usable') {
      acc[band] = (acc[band] ?? 0) + 1;
    }
    return acc;
  }, {});
}

export const handler = async (event: FinalizeEvent | FailEvent): Promise<Record<string, unknown>> => {
  const client = getLeadsClient();
  if (event.action === 'finalize') {
    const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as Record<string, unknown>;
    const { data: rows, error } = await client
      .from('company_website_verifications')
      .select('band, error')
      .eq('foundry_job_id', event.jobId);
    if (error) throw new Error(error.message);
    const counts = countBands((rows ?? []) as Array<{ band: string | null; error?: string | null }>);
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: {
          ...prev,
          current_step: 'done',
          outcome_usable: counts.usable,
          outcome_uncertain: counts.uncertain,
          outcome_not_usable: counts.not_usable,
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
