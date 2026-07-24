import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/supabase/client';
import type { WebhookEventType } from '@/lib/client-api/webhooks/webhookEvents';
import { isValidHttpsWebhookUrl } from '@/lib/client-api/webhooks/webhookUrl';

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

export type McpSessionSummary = {
  id: string;
  client_id: string | null;
  allowed_account_ids: string[];
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
};

async function clientApiInternalFetch(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<any> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in.');
  }
  const clientApiUrl = getClientApiBaseUrl();
  if (!clientApiUrl) {
    throw new Error('Client API URL is not configured in amplify outputs.');
  }
  const response = await fetch(`${clientApiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload;
}

export async function listMcpSessions(): Promise<McpSessionSummary[]> {
  const payload = await clientApiInternalFetch('/internal/mcp/sessions');
  return (payload.data ?? []) as McpSessionSummary[];
}

export async function revokeMcpSession(sessionId: string): Promise<void> {
  await clientApiInternalFetch(`/internal/mcp/sessions/${sessionId}`, { method: 'DELETE' });
}

// Re-export shared policy so UI and API stay aligned.
export { isValidHttpsWebhookUrl };
