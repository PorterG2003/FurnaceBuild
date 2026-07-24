import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetMcpSessionsMemoryForTests,
  issueUserSession,
  resolveUserSession,
  revokeUserSession,
  rotateUserSession,
} from './session.js';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

test.beforeEach(() => {
  __resetMcpSessionsMemoryForTests();
});

test('issueUserSession returns distinct mcpu_ access and refresh tokens', async () => {
  const issued = await issueUserSession({
    userId: 'user-1',
    allowedAccountIds: [ACCOUNT_A],
    supabase: null,
  });

  assert.match(issued.accessToken, /^mcpu_/);
  assert.match(issued.refreshToken, /^mcpu_/);
  assert.notEqual(issued.accessToken, issued.refreshToken);
  assert.equal(issued.session.userId, 'user-1');
  assert.deepEqual(issued.session.allowedAccountIds, [ACCOUNT_A]);
  assert.ok(issued.expiresIn > 0);
});

test('resolveUserSession returns session with grant; null when revoked or expired', async () => {
  const issued = await issueUserSession({
    userId: 'user-1',
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
    supabase: null,
  });

  const resolved = await resolveUserSession(issued.accessToken, { supabase: null });
  assert.ok(resolved);
  assert.equal(resolved!.userId, 'user-1');
  assert.deepEqual(resolved!.allowedAccountIds, [ACCOUNT_A, ACCOUNT_B]);
  assert.equal(resolved!.revokedAt, null);

  const expired = await issueUserSession({
    userId: 'user-2',
    allowedAccountIds: [ACCOUNT_A],
    expiresAt: new Date(Date.now() - 60_000),
    supabase: null,
  });
  assert.equal(await resolveUserSession(expired.accessToken, { supabase: null }), null);

  const toRevoke = await issueUserSession({
    userId: 'user-3',
    allowedAccountIds: [ACCOUNT_A],
    supabase: null,
  });
  assert.equal(await revokeUserSession({ accessToken: toRevoke.accessToken, supabase: null }), true);
  assert.equal(await resolveUserSession(toRevoke.accessToken, { supabase: null }), null);
});

test('rotateUserSession invalidates old refresh, preserves userId+grant; reused refresh fails', async () => {
  const issued = await issueUserSession({
    userId: 'user-1',
    clientId: 'mcp_client_abc',
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
    supabase: null,
  });

  const rotated = await rotateUserSession(issued.refreshToken, { supabase: null });
  assert.ok(rotated);
  assert.match(rotated!.accessToken, /^mcpu_/);
  assert.match(rotated!.refreshToken, /^mcpu_/);
  assert.notEqual(rotated!.accessToken, issued.accessToken);
  assert.notEqual(rotated!.refreshToken, issued.refreshToken);
  assert.equal(rotated!.session.userId, 'user-1');
  assert.equal(rotated!.session.clientId, 'mcp_client_abc');
  assert.deepEqual(rotated!.session.allowedAccountIds, [ACCOUNT_A, ACCOUNT_B]);

  // Old access no longer resolves; new access does.
  assert.equal(await resolveUserSession(issued.accessToken, { supabase: null }), null);
  assert.ok(await resolveUserSession(rotated!.accessToken, { supabase: null }));

  // Reused refresh fails.
  assert.equal(await rotateUserSession(issued.refreshToken, { supabase: null }), null);
});

test('revoke by access token makes resolve null', async () => {
  const issued = await issueUserSession({
    userId: 'user-1',
    allowedAccountIds: [ACCOUNT_A],
    supabase: null,
  });
  assert.ok(await resolveUserSession(issued.accessToken, { supabase: null }));

  const revoked = await revokeUserSession({
    accessToken: issued.accessToken,
    supabase: null,
  });
  assert.equal(revoked, true);
  assert.equal(await resolveUserSession(issued.accessToken, { supabase: null }), null);
});

test('resolveUserSession never returns raw tokens', async () => {
  const issued = await issueUserSession({
    userId: 'user-1',
    allowedAccountIds: [ACCOUNT_A],
    supabase: null,
  });
  const resolved = await resolveUserSession(issued.accessToken, { supabase: null });
  assert.ok(resolved);

  const json = JSON.stringify(resolved);
  assert.doesNotMatch(json, /mcpu_/);
  assert.equal((resolved as Record<string, unknown>).accessToken, undefined);
  assert.equal((resolved as Record<string, unknown>).refreshToken, undefined);
  assert.equal((resolved as Record<string, unknown>).token_hash, undefined);
  assert.equal((resolved as Record<string, unknown>).tokenHash, undefined);
});
