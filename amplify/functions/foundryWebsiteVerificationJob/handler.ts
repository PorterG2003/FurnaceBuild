import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildWebsiteVerificationProgressSnapshot,
  loadWebsiteVerificationProgressCounts,
} from '@furnace/registry-server';

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
  const { data: job } = await client.from('foundry_jobs').select('payload, progress').eq('id', event.jobId).maybeSingle();
  const payload = (job?.payload ?? {}) as Record<string, unknown>;
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  const csvBuilderToolJobId =
    typeof payload.csv_builder_tool_job_id === 'string' && payload.csv_builder_tool_job_id.trim().length > 0
      ? payload.csv_builder_tool_job_id.trim()
      : null;
  if (csvBuilderToolJobId) {
    const rowsFailed = Math.max(0, Math.trunc(Number(prev.rows_failed ?? 0) || 0));
    const status = rowsFailed > 0 ? 'partial' : 'completed';
    if (event.action === 'finalize') {
      await client
        .from('foundry_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          progress: { ...prev, current_step: 'done' },
        })
        .eq('id', event.jobId);
      await client
        .from('csv_builder_column_jobs')
        .update({
          status,
          completed_at: new Date().toISOString(),
          rows_completed: Number(prev.rows_processed ?? 0) || 0,
          rows_failed: rowsFailed,
          error_summary: rowsFailed > 0 ? `${rowsFailed} rows failed` : null,
        })
        .eq('id', csvBuilderToolJobId);
      const { data: toolJob } = await client
        .from('csv_builder_column_jobs')
        .select('output_column_ids')
        .eq('id', csvBuilderToolJobId)
        .maybeSingle();
      const outputColumnIds = Array.isArray(toolJob?.output_column_ids) ? toolJob.output_column_ids : [];
      if (outputColumnIds.length > 0) {
        await client.from('csv_builder_columns').update({ status }).in('id', outputColumnIds);
      }
      return { ok: true };
    }
    const message = typeof event.message === 'string' && event.message.trim() ? event.message.trim() : 'Step Functions failure';
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: message,
        progress: { ...prev, current_step: 'failed' },
      })
      .eq('id', event.jobId);
    await client
      .from('csv_builder_column_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: message,
      })
      .eq('id', csvBuilderToolJobId);
    const { data: toolJob } = await client
      .from('csv_builder_column_jobs')
      .select('output_column_ids')
      .eq('id', csvBuilderToolJobId)
      .maybeSingle();
    const outputColumnIds = Array.isArray(toolJob?.output_column_ids) ? toolJob.output_column_ids : [];
    if (outputColumnIds.length > 0) {
      await client.from('csv_builder_columns').update({ status: 'failed' }).in('id', outputColumnIds);
    }
    return { ok: true };
  }
  const counts = await loadWebsiteVerificationProgressCounts(
    client as unknown as Parameters<typeof loadWebsiteVerificationProgressCounts>[0],
    event.jobId,
  );
  if (event.action === 'finalize') {
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: buildWebsiteVerificationProgressSnapshot(payload, counts, {
          current_step: 'done',
          previous: prev,
        }),
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
      progress: buildWebsiteVerificationProgressSnapshot(payload, counts, {
        current_step: 'failed',
        previous: prev,
      }),
    })
    .eq('id', event.jobId);
  return { ok: true };
};
