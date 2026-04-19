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

type FinalizeEvent = { action: 'finalize'; jobId: string; reconciliationRunId: string };
type FailEvent = { action: 'fail'; jobId: string; reconciliationRunId: string; message?: string };

export const handler = async (event: FinalizeEvent | FailEvent): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: job } = await client.from('foundry_jobs').select('payload, progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as Record<string, unknown>;
    const payload = (job?.payload ?? {}) as Record<string, unknown>;
    const { data: outcomeRows, error: outcomeErr } = await client
      .from('reconciliation_results')
      .select('outcome')
      .eq('reconciliation_run_id', event.reconciliationRunId);
    if (outcomeErr) {
      throw new Error(outcomeErr.message);
    }
    const reconciliationOutcomes = (outcomeRows ?? []).reduce<Record<string, number>>((acc, row) => {
      const outcome = String(row.outcome ?? '');
      if (!outcome) return acc;
      acc[outcome] = (acc[outcome] ?? 0) + 1;
      return acc;
    }, {});

    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: { ...prev, current_step: 'done', reconciliation_outcomes: reconciliationOutcomes },
      })
      .eq('id', event.jobId);

    await client
      .from('reconciliation_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        meta: {
          run_kind: 'state_matching_orchestration',
          ...(typeof payload.preflight === 'object' && payload.preflight ? { preflight: payload.preflight } : {}),
          async: true,
          job_id: event.jobId,
          utah_per_company: prev.utah_per_company,
          florida_per_company: prev.florida_per_company,
          iowa_per_company: prev.iowa_per_company,
        },
      })
      .eq('id', event.reconciliationRunId);

    return { ok: true };
  }

  if ('action' in event && event.action === 'fail') {
    const client = getLeadsClient();
    const msg =
      typeof event.message === 'string' && event.message.trim()
        ? event.message.trim()
        : 'Step Functions failure';
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: msg,
      })
      .eq('id', event.jobId);
    await client
      .from('reconciliation_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        meta: { run_kind: 'state_matching_orchestration', error: msg, job_id: event.jobId },
      })
      .eq('id', event.reconciliationRunId);
    return { ok: true };
  }

  throw new Error('Unknown state-matching action');
};
