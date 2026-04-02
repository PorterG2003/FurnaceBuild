import { StartExecutionCommand, SFNClient } from '@aws-sdk/client-sfn';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  LINKER_VERSION,
  normalizeIngestionRunRecordsChunk,
} from '@furnace/registry-server';

let cachedClient: SupabaseClient | null = null;
const sfnClient = new SFNClient({});

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
    const { data: row } = await client
      .from('foundry_jobs')
      .select('progress, payload, requested_by')
      .eq('id', event.jobId)
      .maybeSingle();
    const prev = (row?.progress ?? {}) as Record<string, unknown>;
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: { ...prev, current_step: 'done' },
      })
      .eq('id', event.jobId);

    const payload = (row?.payload ?? {}) as Record<string, unknown>;
    const ingestionRunId =
      typeof payload.ingestion_run_id === 'string' ? payload.ingestion_run_id.trim() : '';
    if (ingestionRunId) {
      const autolinkSmArn = process.env.FOUNDRY_AUTOLINK_STATE_MACHINE_ARN?.trim();
      if (!autolinkSmArn) {
        console.error('FOUNDRY_AUTOLINK_STATE_MACHINE_ARN missing; cannot start autolink workflow');
        return { ok: true };
      }
      const batchSize = Math.min(
        500,
        Math.max(1, Number.parseInt(process.env.FOUNDRY_AUTO_RESOLVE_BATCH_SIZE ?? '100', 10) || 100),
      );
      const idempotencyKey = `autolink:${ingestionRunId}:${LINKER_VERSION}`;
      try {
        const { data: active } = await client
          .from('foundry_jobs')
          .select('id, step_function_execution_arn')
          .eq('idempotency_key', idempotencyKey)
          .in('status', ['queued', 'running'])
          .maybeSingle();
        if (!active) {
          let autolinkJobId = '';
          const { count, error: countErr } = await client
            .from('source_business_records')
            .select('id', { count: 'exact', head: true })
            .eq('ingestion_run_id', ingestionRunId);
          if (countErr) throw new Error(countErr.message);

          const { data: inserted, error: insertErr } = await client
            .from('foundry_jobs')
            .insert({
              job_type: 'autolink_ingestion_run',
              status: 'queued',
              requested_by: row?.requested_by ?? null,
              payload: { ingestion_run_id: ingestionRunId, batch_size: batchSize },
              idempotency_key: idempotencyKey,
              progress: {
                current_step: 'queued',
                total_rows: count ?? 0,
                rows_processed: 0,
                outcome_linked: 0,
                outcome_needs_review: 0,
                outcome_failed: 0,
                outcome_skipped: 0,
              },
            })
            .select('id')
            .single();
          if (insertErr || !inserted) throw new Error(insertErr?.message ?? 'Failed to insert autolink job');

          autolinkJobId = inserted.id as string;
          const execName = `alink-${autolinkJobId.replace(/-/g, '').slice(0, 12)}-${Date.now()}`;
          let out;
          try {
            out = await sfnClient.send(
              new StartExecutionCommand({
                stateMachineArn: autolinkSmArn,
                name: execName.slice(0, 80),
                input: JSON.stringify({
                  jobId: autolinkJobId,
                  ingestionRunId,
                  batchSize,
                  cursor: null,
                }),
              }),
            );
          } catch (startErr) {
            await client
              .from('foundry_jobs')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_summary: startErr instanceof Error ? startErr.message : String(startErr),
              })
              .eq('id', autolinkJobId);
            throw startErr;
          }

          const executionArn = out.executionArn ?? '';
          const { error: updErr } = await client
            .from('foundry_jobs')
            .update({
              status: 'running',
              step_function_execution_arn: executionArn,
              started_at: new Date().toISOString(),
              progress: {
                current_step: 'running',
                total_rows: count ?? 0,
                rows_processed: 0,
                outcome_linked: 0,
                outcome_needs_review: 0,
                outcome_failed: 0,
                outcome_skipped: 0,
              },
            })
            .eq('id', autolinkJobId);
          if (updErr) {
            console.error('foundry_jobs update after autolink start failed', updErr.message);
          }
        }
      } catch (invokeErr) {
        console.error('Failed to start autolink workflow', invokeErr);
      }
    }

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
  const result = await normalizeIngestionRunRecordsChunk(
    client as unknown as Parameters<typeof normalizeIngestionRunRecordsChunk>[0],
    ingestionRunId,
    batchSize,
    cursor,
  );

  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', jobId).maybeSingle();
  const prev = (job?.progress ?? {}) as Record<string, unknown>;
  let totalRows = Number(prev.total_rows ?? 0);
  if (!Number.isFinite(totalRows) || totalRows < 1) {
    const { count, error: countErr } = await client
      .from('source_business_records')
      .select('id', { count: 'exact', head: true })
      .eq('ingestion_run_id', ingestionRunId);
    if (countErr) throw new Error(countErr.message);
    totalRows = count ?? 0;
  }
  const processed = Number(prev.processed ?? 0) + result.scanned;
  const succeeded = Number(prev.succeeded ?? 0) + result.updated;

  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...prev,
        total_rows: totalRows,
        processed,
        succeeded,
        normalized_done: processed,
        normalized_pending: Math.max(0, totalRows - processed),
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
