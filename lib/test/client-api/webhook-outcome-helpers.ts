import type { ClientApiDbHarness } from './harness.js';

export async function ensureWebhookInfrastructureSchema(
  harness: ClientApiDbHarness,
  t: { skip: (message: string) => void },
): Promise<boolean> {
  const { error: columnError } = await harness.supabase
    .from('webhook_events')
    .select('sqs_enqueued_at')
    .limit(1);
  if (columnError) {
    t.skip(`Webhook infrastructure migration not applied: ${columnError.message}`);
    return false;
  }

  const { error: rpcError } = await harness.supabase.rpc('furnace_emit_webhook_event', {
    p_account_id: harness.accountId,
    p_campaign_id: null,
    p_event_type: 'lead.created',
    p_payload: { probe: true },
    p_dedupe_key: `schema-probe-${harness.namespace}`,
  });
  if (rpcError) {
    t.skip(`furnace_emit_webhook_event RPC unavailable: ${rpcError.message}`);
    return false;
  }

  const { data: probeRows } = await harness.supabase
    .from('webhook_events')
    .select('id')
    .eq('dedupe_key', `schema-probe-${harness.namespace}`);
  for (const row of probeRows ?? []) {
    harness.trackedWebhookEventIds.add(row.id as string);
  }

  return true;
}

export type LatestWebhookEventFilter = {
  campaignId?: string;
};

export async function latestWebhookEvent(
  harness: ClientApiDbHarness,
  eventType: string,
  filter: LatestWebhookEventFilter = {},
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  let query = harness.supabase
    .from('webhook_events')
    .select('id, payload')
    .eq('account_id', harness.accountId)
    .eq('event_type', eventType);
  if (filter.campaignId) {
    query = query.eq('campaign_id', filter.campaignId);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load webhook event: ${error.message}`);
  }
  if (!data) return null;
  harness.trackedWebhookEventIds.add(data.id as string);
  return {
    id: data.id as string,
    payload: (data.payload ?? {}) as Record<string, unknown>,
  };
}
