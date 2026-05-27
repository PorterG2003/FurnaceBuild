import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/supabase/client';

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

export async function verifyWebhookUrl(params: {
  accountId: string;
  campaignId?: string | null;
  url: string;
}): Promise<{ verified: boolean; status: number; token: string; response_body: string }> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to verify webhook URLs.');
  }
  const clientApiUrl = getClientApiBaseUrl();
  if (!clientApiUrl) {
    throw new Error('Client API URL is not configured in amplify outputs.');
  }
  const response = await fetch(`${clientApiUrl}/internal/webhook/verify`, {
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
