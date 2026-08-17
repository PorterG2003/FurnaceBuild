import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';

const custom = (outputs as { custom?: { sendTransactionalEmailUrl?: string } }).custom;
const SEND_TRANSACTIONAL_EMAIL_URL = custom?.sendTransactionalEmailUrl;

async function postJson(url: string, body: Record<string, unknown>, token?: string | null) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText || 'Request failed');
  }
  return data as Record<string, unknown>;
}

function requireTransactionalEmailUrl() {
  if (!SEND_TRANSACTIONAL_EMAIL_URL) {
    throw new Error('Transactional email URL is not configured.');
  }
  return SEND_TRANSACTIONAL_EMAIL_URL;
}

export async function sendTeamInvitationEmail(params: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  accountName: string;
  acceptUrl?: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to send an invitation.');
  return postJson(
    requireTransactionalEmailUrl(),
    { kind: 'team_invitation', ...params },
    token,
  );
}

export async function sendPlatformInviteEmail(params: {
  to: string;
  inviterName: string;
  monthlyRetainerCents: number;
  acceptUrl: string;
  proposalTitle?: string;
  accountName?: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to send a platform invitation.');
  return postJson(
    requireTransactionalEmailUrl(),
    { kind: 'platform_invite', ...params },
    token,
  );
}

export async function sendPlatformAmendmentEmail(params: {
  to: string;
  inviterName: string;
  acceptUrl: string;
  accountName?: string;
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to send amendment email.');
  return postJson(
    requireTransactionalEmailUrl(),
    {
      kind: 'platform_amendment',
      to: params.to,
      inviterName: params.inviterName,
      acceptUrl: params.acceptUrl,
      accountName: params.accountName,
    },
    token,
  );
}

export async function sendHelpMessageEmail(params: {
  notes: string;
  accountName?: string;
  userName?: string;
  topicLabel?: string;
  recipient?: 'porter' | 'kyle';
}) {
  const token = await getAccessToken();
  if (!token) throw new Error('You must be signed in to send a message.');
  return postJson(
    requireTransactionalEmailUrl(),
    { kind: 'help_message', ...params },
    token,
  );
}
