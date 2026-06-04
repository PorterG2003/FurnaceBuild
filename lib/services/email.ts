import outputs from '@/amplify_outputs.json';
import { getAccessToken } from '@/lib/services/auth-token';
import { reportErrorToSlack } from '../slack/reportErrorToSlack';
import { sendTeamInvitationEmail as sendTeamInvitationEmailRequest } from '@/lib/services/transactionalEmail';

const custom = (outputs as { custom?: { testMailboxConnectionUrl?: string } }).custom;
const TEST_MAILBOX_URL = custom?.testMailboxConnectionUrl;

interface SendInvitationEmailParams {
  to: string;
  inviterName: string;
  inviterEmail: string;
  accountName: string;
  acceptUrl?: string;
}

/**
 * Send a team invitation email via the sendTransactionalEmail Lambda (Function URL + Supabase JWT).
 */
export async function sendInvitationEmail(params: SendInvitationEmailParams): Promise<void> {
  try {
    const data = await sendTeamInvitationEmailRequest(params);
    if (!(data as { success?: boolean }).success) {
      const msg =
        (data as { error?: string }).error ||
        (data as { message?: string }).message ||
        'Failed to send invitation email';
      reportErrorToSlack('Send invitation email failed', { severity: 'warning', error: msg });
      throw new Error(msg);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send invitation email failed', { severity: 'warning', error: msg });
    throw error instanceof Error ? error : new Error(msg);
  }
}

interface TestMailboxConnectionParams {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  smtp_use_ssl: boolean;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
}

interface TestMailboxConnectionResult {
  success: boolean;
  smtp: { success: boolean; error?: string };
  imap: { success: boolean; error?: string };
  message: string;
}

/**
 * Test mailbox SMTP and IMAP connections via the testMailboxConnection Lambda (Function URL + Supabase JWT).
 */
export async function testMailboxConnection(
  params: TestMailboxConnectionParams,
): Promise<TestMailboxConnectionResult> {
  if (!TEST_MAILBOX_URL) {
    throw new Error(
      'testMailboxConnection URL not configured. Deploy the Amplify backend and ensure amplify_outputs.json includes custom.testMailboxConnectionUrl.',
    );
  }

  const token = await getAccessToken();
  if (!token) {
    throw new Error('You must be signed in to test mailbox connection.');
  }

  const res = await fetch(TEST_MAILBOX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data as { error?: string }).error || res.statusText;
    reportErrorToSlack('Test mailbox connection failed', { severity: 'warning', error: msg });
    throw new Error(msg || 'Failed to test mailbox connection');
  }

  return data as TestMailboxConnectionResult;
}
