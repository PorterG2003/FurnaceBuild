import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendHelpMessageEmail } from './kinds/helpMessage.js';
import { sendPlatformAmendmentEmail } from './kinds/platformAmendment.js';
import { sendPlatformInviteEmail } from './kinds/platformInvite.js';
import { sendTeamInvitationEmail } from './kinds/teamInvitation.js';

type TransactionalEmailKind =
  | 'team_invitation'
  | 'platform_invite'
  | 'platform_amendment'
  | 'help_message';

function isFunctionUrlEvent(
  event: unknown,
): event is { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean } {
  return !!event && typeof event === 'object' && 'headers' in event && typeof (event as { headers: unknown }).headers === 'object';
}

function parseBody(event: { body?: string | null; isBase64Encoded?: boolean }) {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body
    : '{}';
  return JSON.parse(raw) as Record<string, unknown> & { kind?: TransactionalEmailKind };
}

async function requireAuthenticatedUser(token: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Server configuration error');
  }
  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    throw new Error('Invalid or expired token');
  }
  return { supabase, user };
}

async function requirePlatformAdmin(supabase: SupabaseClient, userId: string) {
  const { data: adminFlag, error: flagError } = await supabase
    .from('user_access_flags')
    .select('user_id')
    .eq('user_id', userId)
    .eq('flag_key', 'platform_admin')
    .maybeSingle();
  if (flagError) {
    throw new Error(flagError.message);
  }
  if (!adminFlag) {
    throw new Error('Not authorized');
  }
}

export const handler = async (
  event: { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean },
) => {
  try {
    if (!isFunctionUrlEvent(event)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unsupported invocation' }) };
    }

    const auth = event.headers?.authorization || event.headers?.Authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
    }

    const args = parseBody(event);
    const kind = args.kind;
    if (!kind) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing kind' }) };
    }

    const { supabase, user } = await requireAuthenticatedUser(token);

    if (kind === 'team_invitation') {
      const result = await sendTeamInvitationEmail({
        to: String(args.to ?? ''),
        inviterName: String(args.inviterName ?? ''),
        inviterEmail: String(args.inviterEmail ?? ''),
        accountName: String(args.accountName ?? ''),
        acceptUrl: args.acceptUrl ? String(args.acceptUrl) : undefined,
      });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (kind === 'help_message') {
      const fromEmail = user.email?.trim();
      if (!fromEmail) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Your account email is missing.' }) };
      }
      const recipient = args.recipient === 'kyle' ? 'kyle' : 'porter';
      const result = await sendHelpMessageEmail({
        fromEmail,
        fromName: String(args.userName ?? '').trim() || fromEmail,
        accountName: String(args.accountName ?? ''),
        topicLabel: String(args.topicLabel ?? 'Technical support'),
        notes: String(args.notes ?? ''),
        recipient,
      });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    await requirePlatformAdmin(supabase, user.id);

    if (kind === 'platform_invite') {
      const result = await sendPlatformInviteEmail({
        to: String(args.to ?? ''),
        inviterName: String(args.inviterName ?? ''),
        monthlyRetainerCents: Number(args.monthlyRetainerCents ?? 0),
        acceptUrl: String(args.acceptUrl ?? ''),
        proposalTitle: args.proposalTitle ? String(args.proposalTitle) : undefined,
        accountName: args.accountName ? String(args.accountName) : undefined,
      });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (kind === 'platform_amendment') {
      const result = await sendPlatformAmendmentEmail({
        to: String(args.to ?? ''),
        inviterName: String(args.inviterName ?? ''),
        acceptUrl: String(args.acceptUrl ?? ''),
        accountName: args.accountName ? String(args.accountName) : undefined,
      });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Unknown kind: ${kind}` }) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send transactional email failed', { severity: 'warning', error: msg });
    const statusCode =
      msg === 'Invalid or expired token' || msg === 'Missing or invalid Authorization header'
        ? 401
        : msg === 'Not authorized'
          ? 403
          : msg === 'Server configuration error'
            ? 500
            : 500;
    return { statusCode, body: JSON.stringify({ error: msg }) };
  }
};
