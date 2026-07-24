import crypto from 'node:crypto';
import { isValidHttpsWebhookUrl } from './webhookUrl.js';

export type WebhookEnvelope = {
  id: string;
  type: string;
  occurred_at: string;
  data: Record<string, unknown>;
};

export { isValidHttpsWebhookUrl } from './webhookUrl.js';

export function buildWebhookSignature(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function buildWebhookEnvelope(
  eventType: string,
  data: Record<string, unknown>,
  eventId?: string,
): WebhookEnvelope {
  return {
    id: eventId ?? crypto.randomUUID(),
    type: eventType,
    occurred_at: new Date().toISOString(),
    data,
  };
}

export async function deliverWebhookPost(params: {
  endpointUrl: string;
  signingSecret?: string;
  eventType: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
  eventId?: string;
}): Promise<{
  ok: boolean;
  status: number;
  responseBody: string;
  requestBody: string;
  envelope: WebhookEnvelope;
}> {
  if (!isValidHttpsWebhookUrl(params.endpointUrl)) {
    return {
      ok: false,
      status: 0,
      responseBody: 'Webhook URL is not a public HTTPS endpoint',
      requestBody: '',
      envelope: buildWebhookEnvelope(params.eventType, params.payload, params.eventId),
    };
  }

  const envelope = buildWebhookEnvelope(params.eventType, params.payload, params.eventId);
  const requestBody = JSON.stringify(envelope);
  const secret = params.signingSecret?.trim() ?? '';
  const deliveryId = params.deliveryId ?? crypto.randomUUID();

  const response = await fetch(params.endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Furnace-Event': params.eventType,
      'X-Furnace-Delivery': deliveryId,
      ...(secret ? { 'X-Furnace-Signature': buildWebhookSignature(secret, requestBody) } : {}),
    },
    body: requestBody,
  });

  let responseBody = '';
  try {
    responseBody = await response.text();
  } catch {
    responseBody = '';
  }

  return {
    ok: response.ok,
    status: response.status,
    responseBody,
    requestBody,
    envelope,
  };
}
