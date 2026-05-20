import crypto from 'node:crypto';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';

function buildSignature(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

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
    .select('webhook_url, webhook_signing_secret, webhook_enabled_events, webhook_url_verified_at')
    .eq('id', evt.account_id)
    .maybeSingle();
  if (accountError) throw new Error(`Failed to load account webhook settings: ${accountError.message}`);

  const { data: campaign } = evt.campaign_id
    ? await supabase
        .from('campaigns')
        .select('webhook_url_override, webhook_signing_secret_override, webhook_enabled_events_override, webhook_url_override_verified_at')
        .eq('id', evt.campaign_id)
        .maybeSingle()
    : { data: null };

  const endpointUrl = (campaign?.webhook_url_override || account?.webhook_url || '').trim();
  if (!endpointUrl) return;
  const enabledEvents = Array.isArray(campaign?.webhook_enabled_events_override)
    ? campaign?.webhook_enabled_events_override
    : Array.isArray(account?.webhook_enabled_events)
      ? account?.webhook_enabled_events
      : [];
  if (enabledEvents.length > 0 && !enabledEvents.includes(evt.event_type)) {
    return;
  }
  if (campaign?.webhook_url_override && !campaign?.webhook_url_override_verified_at) return;
  if (!campaign?.webhook_url_override && !account?.webhook_url_verified_at) return;
  const secret = (campaign?.webhook_signing_secret_override || account?.webhook_signing_secret || '').trim();
  const payload = {
    id: evt.id,
    type: evt.event_type,
    occurred_at: new Date().toISOString(),
    data: evt.payload,
  };
  const requestBody = JSON.stringify(payload);

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
      request_body: payload,
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
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Furnace-Event': evt.event_type,
          'X-Furnace-Delivery': delivery.id,
          ...(secret ? { 'X-Furnace-Signature': buildSignature(secret, requestBody) } : {}),
        },
        body: requestBody,
      });
      lastStatus = response.status;
      responseBody = await response.text();
      if (response.ok) {
        delivered = true;
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'delivered',
            attempt_count: attempt,
            response_status: response.status,
            response_body: responseBody.slice(0, 4000),
            delivered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', delivery.id);
        break;
      }
      lastError = `HTTP ${response.status}`;
      await supabase
        .from('webhook_deliveries')
        .update({
          attempt_count: attempt,
          response_status: response.status,
          response_body: responseBody.slice(0, 4000),
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
