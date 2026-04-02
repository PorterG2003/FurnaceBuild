import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { autoResolveSourceRecord, listSourceRecordIdsPageForIngestionRun } from '@furnace/registry-server';

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

type AutolinkProgress = Record<string, unknown> & {
  total_rows?: number;
  rows_processed?: number;
  outcome_linked?: number;
  outcome_needs_review?: number;
  outcome_failed?: number;
  outcome_skipped?: number;
};

function increment(progress: AutolinkProgress, key: keyof AutolinkProgress, amount = 1): number {
  return Number(progress[key] ?? 0) + amount;
}

function applyOutcome(progress: AutolinkProgress, outcome: { outcome: string; reason?: string | null }): AutolinkProgress {
  const next = { ...progress };
  next.rows_processed = increment(next, 'rows_processed');
  switch (outcome.outcome) {
    case 'auto_linked':
    case 'created_company_and_linked':
      next.outcome_linked = increment(next, 'outcome_linked');
      break;
    case 'review_task_created':
      next.outcome_needs_review = increment(next, 'outcome_needs_review');
      break;
    case 'skipped':
      if (outcome.reason === 'already_linked') {
        next.outcome_linked = increment(next, 'outcome_linked');
      } else {
        next.outcome_skipped = increment(next, 'outcome_skipped');
      }
      break;
    case 'error':
    default:
      next.outcome_failed = increment(next, 'outcome_failed');
      break;
  }
  return next;
}

export const handler = async (event: ChunkEvent | FinalizeEvent | FailEvent): Promise<Record<string, unknown>> => {
  if ('action' in event && event.action === 'finalize') {
    const client = getLeadsClient();
    const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', event.jobId).maybeSingle();
    const prev = (job?.progress ?? {}) as AutolinkProgress;
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
  const client = getLeadsClient();
  const batchSize = Math.min(500, Math.max(1, Number(e.batchSize) || 100));
  const page = await listSourceRecordIdsPageForIngestionRun(
    client as unknown as Parameters<typeof listSourceRecordIdsPageForIngestionRun>[0],
    e.ingestionRunId,
    batchSize,
    e.cursor ?? null,
  );

  const { data: job } = await client.from('foundry_jobs').select('progress').eq('id', e.jobId).maybeSingle();
  let progress = (job?.progress ?? {}) as AutolinkProgress;
  if (progress.total_rows == null) {
    const { count, error: countErr } = await client
      .from('source_business_records')
      .select('id', { count: 'exact', head: true })
      .eq('ingestion_run_id', e.ingestionRunId);
    if (countErr) throw new Error(countErr.message);
    progress.total_rows = count ?? 0;
  }

  for (const id of page.ids) {
    try {
      const result = await autoResolveSourceRecord(
        client as unknown as Parameters<typeof autoResolveSourceRecord>[0],
        id,
      );
      progress = applyOutcome(progress, { outcome: result.outcome, reason: 'reason' in result ? result.reason : null });
    } catch (rowErr) {
      console.error('autoResolveSourceRecord failed', id, rowErr);
      progress = applyOutcome(progress, { outcome: 'error', reason: null });
    }
  }

  await client
    .from('foundry_jobs')
    .update({
      status: 'running',
      progress: {
        ...progress,
        processed: Number(progress.rows_processed ?? 0),
        current_step: 'autolink_chunk',
        cursor: page.nextCursor,
      },
    })
    .eq('id', e.jobId);

  return {
    done: page.done,
    nextCursor: page.nextCursor,
    scanned: page.ids.length,
  };
};
