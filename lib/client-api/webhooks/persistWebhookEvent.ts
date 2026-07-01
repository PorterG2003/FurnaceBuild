import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ALLOWED_WEBHOOK_EVENTS, type WebhookEventType } from './webhookEvents.js';

export type PersistWebhookEventParams = {
  accountId: string;
  campaignId?: string | null;
  eventType: WebhookEventType | string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

export type PersistWebhookEventOptions = {
  /** When true, dedupe conflicts and insert errors return null instead of throwing. */
  failSilent?: boolean;
};

export async function persistWebhookEvent(
  supabase: SupabaseClient,
  params: PersistWebhookEventParams,
  options?: PersistWebhookEventOptions,
): Promise<string | null> {
  const failSilent = options?.failSilent ?? false;
  if (!(DEFAULT_ALLOWED_WEBHOOK_EVENTS as readonly string[]).includes(params.eventType)) {
    if (failSilent) {
      console.error('[webhooks] rejected unknown event type', params.eventType);
      return null;
    }
    throw new Error(`Unsupported webhook event type: ${params.eventType}`);
  }

  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: params.accountId,
      campaign_id: params.campaignId ?? null,
      event_type: params.eventType,
      payload: params.payload,
      dedupe_key: params.dedupeKey,
    } as never)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return null;
    if (failSilent) {
      console.error('[webhooks] failed to insert webhook_events', error);
      return null;
    }
    throw new Error(`Failed to persist webhook event: ${error.message}`);
  }

  return data?.id as string;
}
