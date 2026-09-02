import type { SupabaseClient } from '@supabase/supabase-js';

const WORKER_WEBHOOK_EVENT_TYPES = new Set([
  'reply.received',
  'bounce.detected',
]);

export async function emitWebhookEvent(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    campaignId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<void> {
  if (!WORKER_WEBHOOK_EVENT_TYPES.has(params.eventType)) {
    console.error('[webhooks] rejected unknown event type', params.eventType);
    return;
  }

  const { error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: params.accountId,
      campaign_id: params.campaignId ?? null,
      event_type: params.eventType,
      payload: params.payload,
      dedupe_key: params.dedupeKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return;
    console.error('[webhooks] failed to insert webhook_events', error);
  }
}
