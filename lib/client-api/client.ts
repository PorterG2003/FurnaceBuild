import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/supabase/client';

const custom = (outputs as { custom?: { clientApiUrl?: string } }).custom;
const CLIENT_API_URL = custom?.clientApiUrl?.replace(/\/$/, '') ?? null;

export function getClientApiBaseUrl(): string | null {
  return CLIENT_API_URL;
}

export async function verifyWebhookUrl(params: {
  accountId: string;
  campaignId?: string | null;
  url: string;
}): Promise<{ verified: boolean; status: number; token: string; response_body: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to verify webhook URLs.');
  }
  if (!CLIENT_API_URL) {
    throw new Error('Client API URL is not configured in amplify outputs.');
  }
  const response = await fetch(`${CLIENT_API_URL}/internal/webhook/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload?.data) {
    throw new Error(payload?.error?.message || 'Webhook verification failed.');
  }
  return payload.data as { verified: boolean; status: number; token: string; response_body: string };
}
