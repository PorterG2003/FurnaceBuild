import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  autoResolveSourceRecord,
  listSourceRecordIdsPageForIngestionRun,
  normalizeIngestionRunRecordsChunk,
} from '@furnace/registry-server';

let cachedClient: SupabaseClient | null = null;
const lambdaClient = new LambdaClient({});

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

type AutoResolveEvent = {
  action: 'auto_resolve_ingestion_run';
  ingestionRunId: string;
  cursor: string | null;
};

async function invokeSelfAsync(payload: AutoResolveEvent): Promise<void> {
  const name = process.env.AWS_LAMBDA_FUNCTION_NAME?.trim();
  if (!name) {
    console.error('AWS_LAMBDA_FUNCTION_NAME missing; cannot chain auto-resolve');
    return;
  }
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: name,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload), 'utf8'),
    }),
  );
}

export const handler = async (
  event: ChunkEvent | FinalizeEvent | FailEvent | AutoResolveEvent,
): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'auto_resolve_ingestion_run') {
    const client = getLeadsClient();
    const batchSize = Math.min(
      200,
      Math.max(1, Number.parseInt(process.env.FOUNDRY_AUTO_RESOLVE_BATCH_SIZE ?? '40', 10) || 40),
    );
    const { ingestionRunId, cursor } = event;
    try {
      const page = await listSourceRecordIdsPageForIngestionRun(
        client,
        ingestionRunId,
        batchSize,
        cursor,
      );
      for (const id of page.ids) {
        try {
          await autoResolveSourceRecord(client, id);
        } catch (rowErr) {
          console.error('autoResolveSourceRecord failed', id, rowErr);
        }
      }
      if (!page.done && page.nextCursor != null) {
        await invokeSelfAsync({
          action: 'auto_resolve_ingestion_run',
          ingestionRunId,
          cursor: page.nextCursor,
        });
      }
    } catch (e) {
      console.error('auto_resolve_ingestion_run page failed', ingestionRunId, e);
    }
    return { ok: true };
  }

  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: row } = await client
      .from('foundry_jobs')
      .select('progress, payload')
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
      try {
        await invokeSelfAsync({
          action: 'auto_resolve_ingestion_run',
          ingestionRunId,
          cursor: null,
        });
      } catch (invokeErr) {
        console.error('Failed to invoke auto_resolve chain', invokeErr);
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
