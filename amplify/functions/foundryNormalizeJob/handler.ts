import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeIngestionRunRecordsChunk } from '@furnace/registry-server';

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

type ChunkEvent = {
  action?: 'chunk';
  jobId: string;
  ingestionRunId: string;
  batchSize: number;
  cursor: string | null;
};

type FinalizeEvent = { action: 'finalize'; jobId: string };
type FailEvent = { action: 'fail'; jobId: string; message?: string };

export const handler = async (
  event: ChunkEvent | FinalizeEvent | FailEvent,
): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: row } = await client.from('foundry_jobs').select('progress').eq('id', event.jobId).maybeSingle();
    const prev = (row?.progress ?? {}) as Record<string, unknown>;
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: { ...prev, current_step: 'done' },
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  if ('action' in event && event.action === 'fail') {
    const client = getLeadsClient();
    await client
      .from('foundry_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_summary: event.message ?? 'Step Functions failure',
      })
      .eq('id', event.jobId);
    return { ok: true };
  }

  const e = event as ChunkEvent;
  const jobId = e.jobId;
  const ingestionRunId = e.ingestionRunId;
  const batchSize = Math.min(2000, Math.max(1, Number(e.batchSize) || 500));
  const cursor = e.cursor ?? null;

  const client = getLeadsClient();
  const result = await normalizeIngestionRunRecordsChunk(client, ingestionRunId, batchSize, cursor);

  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', jobId).maybeSingle();
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  const processed = Number(prev.processed ?? 0) + result.scanned;
  const succeeded = Number(prev.succeeded ?? 0) + result.updated;

  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...prev,
        processed,
        succeeded,
        current_step: 'normalize_chunk',
        cursor: result.nextCursor,
        last_chunk: { updated: result.updated, scanned: result.scanned },
      },
    })
    .eq('id', jobId);

  return {
    done: result.done,
    nextCursor: result.nextCursor,
    updated: result.updated,
    scanned: result.scanned,
  };
};
