import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildGoogleAdsVerificationProgressSnapshot,
  loadGoogleAdsVerificationProgressCounts,
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
  if (event.action === 'finalize') {
    const { data: job } = await client.from('foundry_jobs').select('payload, progress').eq('id', event.jobId).maybeSingle();
    const payload = (job?.payload ?? {}) as Record<string, unknown>;
    const prev = (job?.progress ?? {}) as Record<string, unknown>;
    const counts = await loadGoogleAdsVerificationProgressCounts(
      client as unknown as Parameters<typeof loadGoogleAdsVerificationProgressCounts>[0],
      event.jobId,
    );
    await client
      .from('foundry_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress: buildGoogleAdsVerificationProgressSnapshot(payload, counts, {
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
    })
    .eq('id', event.jobId);
  return { ok: true };
};
