import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/supabase/client';
import type { WebhookEventType } from '@/lib/client-api/webhooks/webhookEvents';

const custom = (outputs as { custom?: { clientApiUrl?: string } }).custom;

export function getClientApiBaseUrl(): string | null {
  const fromEnv =
    process.env.EXPO_PUBLIC_CLIENT_API_URL?.trim() ||
    process.env.EXPO_PUBLIC_CLIENT_API_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }

  return custom?.clientApiUrl?.replace(/\/$/, '') ?? null;
}

export type SendTestWebhookResult = {
  success: boolean;
  status: number;
  response_body: string;
  event_type: string;
  request_body: Record<string, unknown>;
};

export async function sendTestWebhook(params: {
  accountId: string;
  campaignId?: string | null;
  url?: string;
  signingSecret?: string;
  eventType?: WebhookEventType;
}): Promise<SendTestWebhookResult> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to send test webhooks.');
  }
  const clientApiUrl = getClientApiBaseUrl();
  if (!clientApiUrl) {
    throw new Error('Client API URL is not configured in amplify outputs.');
  }
  const response = await fetch(`${clientApiUrl}/internal/webhook/test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload?.data) {
    throw new Error(payload?.error?.message || 'Test webhook delivery failed.');
  }
  return payload.data as SendTestWebhookResult;
}

export function isValidHttpsWebhookUrl(url: string): boolean {
  try {
    return new URL(url.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}
