import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUserSession, isMcpUserToken } from '../mcp/session.js';
import type { AuthenticatedApiKey } from './auth.js';

export type UserAuthSuccess = {
  ok: true;
  auth: AuthenticatedApiKey;
};

export type UserAuthFailure = {
  ok: false;
  status: 400 | 401 | 403;
  code: string;
  message: string;
};

export type UserAuthResult = UserAuthSuccess | UserAuthFailure;

/**
 * Resolve a user-scoped MCP session for a Client API request.
 * Requires X-Furnace-Account-Id; asserts grant + live membership.
 */
export async function resolveUserRequest(params: {
  token: string;
  accountId: string | null | undefined;
  supabase: SupabaseClient;
}): Promise<UserAuthResult> {
  const { token, supabase } = params;
  if (!isMcpUserToken(token)) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_token',
      message: 'Invalid or expired MCP user session',
    };
  }

  const accountId = typeof params.accountId === 'string' ? params.accountId.trim() : '';
  if (!accountId) {
    return {
      ok: false,
      status: 400,
      code: 'missing_account_id',
      message: 'X-Furnace-Account-Id header is required for MCP user sessions',
    };
  }

  const session = await resolveUserSession(token, { supabase });
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_token',
      message: 'Invalid, expired, or revoked MCP user session',
    };
  }

  if (!session.allowedAccountIds.includes(accountId)) {
    return {
      ok: false,
      status: 403,
      code: 'account_not_granted',
      message: 'This MCP session was not granted access to that account',
    };
  }

  const { data: membership, error } = await supabase
    .from('account_users')
    .select('role, is_owner')
    .eq('account_id', accountId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify membership: ${error.message}`);
  }
  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: 'not_a_member',
      message: 'You are not a member of that account',
    };
  }

  const role = (membership as { role?: string }).role ?? 'member';

  return {
    ok: true,
    auth: {
      id: null,
      accountId,
      name: `MCP user session (${session.id.slice(0, 8)})`,
      secretPrefix: 'mcpu_',
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      authKind: 'user',
      actorUserId: session.userId,
      actorRole: role,
    },
  };
}
