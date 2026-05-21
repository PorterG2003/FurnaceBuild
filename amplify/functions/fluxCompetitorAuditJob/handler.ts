import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

function getFluxClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

type FailEvent = { action: 'fail'; jobId: string; message?: string };

function summarizeFailureMessage(raw: string | undefined): string {
  const fallback = 'Competitor audit worker failed before it could persist results.';
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as {
      Containers?: Array<{ ExitCode?: number; Name?: string }>;
      StoppedReason?: string;
      StopCode?: string;
    };
    const exitCode = parsed.Containers?.[0]?.ExitCode;
    const stopReason = parsed.StoppedReason?.trim();
    const stopCode = parsed.StopCode?.trim();
    if (typeof exitCode === 'number' && stopReason) {
      return `Worker task exited with code ${exitCode}: ${stopReason}`.slice(0, 12_000);
    }
    if (stopReason && stopCode) {
      return `${stopCode}: ${stopReason}`.slice(0, 12_000);
    }
    if (stopReason) {
      return stopReason.slice(0, 12_000);
    }
  } catch {
    // Step Functions sometimes passes a plain string rather than JSON.
  }

  return trimmed.slice(0, 12_000);
}

export const handler = async (event: FailEvent): Promise<Record<string, unknown>> => {
  if (event.action !== 'fail') {
    throw new Error(`Unsupported action: ${String((event as { action?: string }).action)}`);
  }

  const client = getFluxClient();
  const message = summarizeFailureMessage(event.message);

  const { data: job, error: jobError } = await client
    .from('flux_async_jobs')
    .select('id, status, subject_id, payload')
    .eq('id', event.jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return { ok: true, skipped: 'job_not_found' };

  await client
    .from('flux_async_jobs')
    .update({
      status: 'failed',
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .eq('id', event.jobId)
    .in('status', ['queued', 'running']);

  const blockId = typeof job.payload?.block_id === 'string' ? job.payload.block_id.trim() : '';
  const pageId = typeof job.subject_id === 'string' ? job.subject_id : '';
  if (!blockId || !pageId) {
    return { ok: true, skipped: 'missing_page_or_block' };
  }

  const { data: page, error: pageError } = await client
    .from('flux_prospect_pages')
    .select('page_config')
    .eq('id', pageId)
    .maybeSingle();
  if (pageError) throw pageError;
  const cfg = (page?.page_config ?? {}) as { blocks?: Array<Record<string, unknown>> };
  const blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];
  let changed = false;

  const nextBlocks = blocks.map((block) => {
    if (!block || typeof block !== 'object' || block.id !== blockId) return block;
    if (block.type !== 'competitor_ad_audit') return block;
    const props = typeof block.props === 'object' && block.props ? block.props : {};
    changed = true;
    return {
      ...block,
      props: {
        ...props,
        status: 'error',
        errorMessage: message,
      },
    };
  });

  if (changed) {
    const { error: updatePageError } = await client
      .from('flux_prospect_pages')
      .update({ page_config: { ...cfg, blocks: nextBlocks } as never })
      .eq('id', pageId);
    if (updatePageError) throw updatePageError;
  }

  return { ok: true };
};
