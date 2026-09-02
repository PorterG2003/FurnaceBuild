import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';
import { deliverWebhookPost, isValidHttpsWebhookUrl } from '../../../lib/client-api/webhooks/deliverWebhookPost.js';
import { expandStoredWebhookEvents } from '../../../lib/client-api/webhooks/eventGroups.js';

export async function processWebhookEventById(eventId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: evt, error: eventError } = await supabase
    .from('webhook_events')
    .select('id, account_id, campaign_id, event_type, payload')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw new Error(`Failed to load webhook event: ${eventError.message}`);
  if (!evt) return;

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('webhook_url, webhook_signing_secret, webhook_enabled_events')
    .eq('id', evt.account_id)
    .maybeSingle();
  if (accountError) throw new Error(`Failed to load account webhook settings: ${accountError.message}`);

  const { data: campaign } = evt.campaign_id
    ? await supabase
        .from('campaigns')
        .select('webhook_url_override, webhook_signing_secret_override, webhook_enabled_events_override')
        .eq('id', evt.campaign_id)
        .maybeSingle()
    : { data: null };

  const endpointUrl = (campaign?.webhook_url_override || account?.webhook_url || '').trim();
  if (!endpointUrl) return;
  if (!isValidHttpsWebhookUrl(endpointUrl)) {
    // Do not deliver to private/local HTTPS targets (SSRF guard for stored URLs).
    return;
  }
  const enabledEvents = expandStoredWebhookEvents(
    campaign?.webhook_enabled_events_override ?? account?.webhook_enabled_events,
  );
  if (enabledEvents.length === 0 || !enabledEvents.includes(evt.event_type as typeof enabledEvents[number])) {
    return;
  }
  const secret = (campaign?.webhook_signing_secret_override || account?.webhook_signing_secret || '').trim();
  const payload = evt.payload && typeof evt.payload === 'object'
    ? (evt.payload as Record<string, unknown>)
    : {};

  const { data: existingDelivery } = await supabase
    .from('webhook_deliveries')
    .select('id')
    .eq('webhook_event_id', evt.id)
    .eq('status', 'delivered')
    .maybeSingle();
  if (existingDelivery) return;

  const { data: delivery, error: deliveryError } = await supabase
    .from('webhook_deliveries')
    .insert({
      webhook_event_id: evt.id,
      account_id: evt.account_id,
      campaign_id: evt.campaign_id,
      endpoint_url: endpointUrl,
      event_type: evt.event_type,
      status: 'sending',
      attempt_count: 0,
      request_body: {
        id: evt.id,
        type: evt.event_type,
        occurred_at: new Date().toISOString(),
        data: payload,
      },
      last_attempt_at: new Date().toISOString(),
    } as never)
    .select('*')
    .single();
  if (deliveryError) throw new Error(`Failed to create webhook delivery row: ${deliveryError.message}`);

  let lastError: string | null = null;
  let delivered = false;
  let lastStatus: number | null = null;
  let responseBody: string | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await deliverWebhookPost({
        endpointUrl,
        signingSecret: secret || undefined,
        eventType: evt.event_type,
        payload,
        deliveryId: delivery.id,
        eventId: evt.id,
      });
      lastStatus = result.status;
      responseBody = result.responseBody;
      if (result.ok) {
        delivered = true;
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'delivered',
            attempt_count: attempt,
            response_status: result.status,
            response_body: result.responseBody.slice(0, 4000),
            delivered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', delivery.id);
        break;
      }
      lastError = `HTTP ${result.status}`;
      await supabase
        .from('webhook_deliveries')
        .update({
          attempt_count: attempt,
          response_status: result.status,
          response_body: result.responseBody.slice(0, 4000),
          error: lastError,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', delivery.id);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await supabase
        .from('webhook_deliveries')
        .update({
          attempt_count: attempt,
          error: lastError,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', delivery.id);
    }
  }

  if (!delivered) {
    await supabase
      .from('webhook_deliveries')
      .update({
        status: 'failed',
        response_status: lastStatus,
        response_body: responseBody?.slice(0, 4000) ?? null,
        error: lastError,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', delivery.id);
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body ?? '{}') as { eventId?: string };
      if (!parsed.eventId) continue;
      await processWebhookEventById(parsed.eventId);
    } catch (error) {
      console.error('[processWebhookEvent] failed record', error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
