import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUserRequest } from './user-auth.js';
import { hashToken } from '../mcp/auth.js';
import {
  __resetMcpSessionsMemoryForTests,
  issueUserSession,
} from '../mcp/session.js';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_OTHER = '33333333-3333-4333-8333-333333333333';

test.beforeEach(() => {
  __resetMcpSessionsMemoryForTests();
});

type SessionRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  allowed_account_ids: string[];
  scopes: string[];
  expires_at: string | null;
  refresh_expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  token_hash: string;
};

/**
 * Mock supabase for resolveUserRequest: session lookup + membership.
 * Session was issued via memory; we mirror the row for the DB resolve path.
 */
function createUserAuthMock(options: {
  session: SessionRow | null;
  membership?: { role: string; is_owner: boolean } | null;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'mcp_oauth_sessions') {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = () => self();
        chain.update = () => self();
        chain.eq = (col: string, val: unknown) => {
          chain._eq = { col, val };
          return self();
        };
        chain.maybeSingle = async () => {
          const eq = chain._eq as { col: string; val: unknown } | undefined;
          if (!options.session) return { data: null, error: null };
          if (eq?.col === 'token_hash' && eq.val === options.session.token_hash) {
            return { data: options.session, error: null };
          }
          return { data: null, error: null };
        };
        return chain;
      }
      if (table === 'account_users') {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = () => self();
        chain.eq = () => self();
        chain.maybeSingle = async () => ({
          data: options.membership === undefined ? null : options.membership,
          error: null,
        });
        return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function issueAndMirrorSession(allowedAccountIds: string[]) {
  const issued = await issueUserSession({
    userId: 'user-1',
    allowedAccountIds,
    supabase: null,
  });
  const session: SessionRow = {
    id: issued.session.id,
    user_id: issued.session.userId,
    client_id: issued.session.clientId,
    allowed_account_ids: issued.session.allowedAccountIds,
    scopes: issued.session.scopes,
    expires_at: issued.session.expiresAt,
    refresh_expires_at: issued.session.refreshExpiresAt,
    revoked_at: issued.session.revokedAt,
    last_used_at: issued.session.lastUsedAt,
    created_at: issued.session.createdAt,
    token_hash: hashToken(issued.accessToken),
  };
  return { issued, session };
}

test('resolveUserRequest returns 400 when X-Furnace-Account-Id / accountId is missing', async () => {
  const { issued, session } = await issueAndMirrorSession([ACCOUNT_A]);
  const supabase = createUserAuthMock({ session, membership: { role: 'admin', is_owner: true } });

  for (const accountId of [null, undefined, '', '   '] as const) {
    const result = await resolveUserRequest({
      token: issued.accessToken,
      accountId,
      supabase,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('expected failure');
    assert.equal(result.status, 400);
    assert.equal(result.code, 'missing_account_id');
  }
});

test('resolveUserRequest returns 403 when account is not in grant', async () => {
  const { issued, session } = await issueAndMirrorSession([ACCOUNT_A]);
  const supabase = createUserAuthMock({
    session,
    membership: { role: 'admin', is_owner: true },
  });

  const result = await resolveUserRequest({
    token: issued.accessToken,
    accountId: ACCOUNT_OTHER,
    supabase,
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.status, 403);
  assert.equal(result.code, 'account_not_granted');
});

test('resolveUserRequest returns 403 when user is not a member', async () => {
  const { issued, session } = await issueAndMirrorSession([ACCOUNT_A, ACCOUNT_B]);
  const supabase = createUserAuthMock({
    session,
    membership: null,
  });

  const result = await resolveUserRequest({
    token: issued.accessToken,
    accountId: ACCOUNT_A,
    supabase,
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.status, 403);
  assert.equal(result.code, 'not_a_member');
});

test('resolveUserRequest succeeds for granted member', async () => {
  const { issued, session } = await issueAndMirrorSession([ACCOUNT_A]);
  const supabase = createUserAuthMock({
    session,
    membership: { role: 'admin', is_owner: true },
  });

  const result = await resolveUserRequest({
    token: issued.accessToken,
    accountId: ACCOUNT_A,
    supabase,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected success');
  assert.equal(result.auth.accountId, ACCOUNT_A);
  assert.equal(result.auth.authKind, 'user');
  assert.equal(result.auth.actorUserId, 'user-1');
  assert.equal(result.auth.actorRole, 'admin');
  assert.equal(result.auth.secretPrefix, 'mcpu_');
});
