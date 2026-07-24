import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBearerToken,
  signMcpAccessToken,
  verifyMcpAccessToken,
  resolveMcpAuthorization,
} from './auth.js';
import {
  buildProtectedResourceMetadata,
  oauthAuthorizationServerMetadata,
} from './oauth.js';

test('getBearerToken parses Authorization header', () => {
  assert.equal(getBearerToken('Bearer f_abc'), 'f_abc');
  assert.equal(getBearerToken('bearer f_abc'), 'f_abc');
  assert.equal(getBearerToken(undefined), null);
  assert.equal(getBearerToken('Basic x'), null);
});

test('signed MCP access tokens round-trip and expire', () => {
  const token = signMcpAccessToken({
    accountId: 'acct-1',
    apiKey: 'f_secret',
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const verified = verifyMcpAccessToken(token);
  assert.deepEqual(verified, { accountId: 'acct-1', apiKey: 'f_secret' });

  const expired = signMcpAccessToken({
    accountId: 'acct-1',
    apiKey: 'f_secret',
    exp: Math.floor(Date.now() / 1000) - 10,
  });
  assert.equal(verifyMcpAccessToken(expired), null);
});

test('resolveMcpAuthorization rejects f_ API keys when Supabase is unavailable', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const result = await resolveMcpAuthorization('Bearer f_test_key');
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('expected failure');
    assert.match(result.message, /API key validation unavailable|not recognized/i);
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevKey;
  }
});

test('resolveMcpAuthorization rejects signed oauth tokens whose linked API key cannot be validated', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const token = signMcpAccessToken({
      accountId: 'acct-1',
      apiKey: 'f_linked',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    // Signature verifies, but linked f_ key must still exist in account_api_keys.
    assert.ok(verifyMcpAccessToken(token));
    const result = await resolveMcpAuthorization(`Bearer ${token}`);
    assert.equal(result.ok, false);
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevKey;
  }
});

test('resolveMcpAuthorization rejects missing/invalid tokens', async () => {
  assert.equal((await resolveMcpAuthorization(undefined)).ok, false);
  assert.equal((await resolveMcpAuthorization('Bearer nope')).ok, false);
});

test('resolveMcpAuthorization rejects mcpu_ tokens without a session', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const result = await resolveMcpAuthorization('Bearer mcpu_no_such_session_token');
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('expected failure');
    assert.match(result.message, /invalid, expired, or revoked MCP user session/i);
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevKey;
  }
});

test('oauth protected resource and AS metadata shapes', () => {
  const pr = buildProtectedResourceMetadata('https://mcp.example.com');
  assert.equal(pr.resource, 'https://mcp.example.com');
  assert.deepEqual(pr.authorization_servers, ['https://mcp.example.com']);
  assert.ok(pr.scopes_supported.includes('furnace.mcp'));

  const as = oauthAuthorizationServerMetadata('https://mcp.example.com');
  assert.equal(as.issuer, 'https://mcp.example.com');
  assert.match(as.authorization_endpoint, /\/oauth\/authorize$/);
  assert.match(as.token_endpoint, /\/oauth\/token$/);
  assert.match(as.registration_endpoint, /\/oauth\/register$/);
  assert.match(as.revocation_endpoint, /\/oauth\/revoke$/);
  assert.ok(as.scopes_supported.includes('furnace.mcp'));
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
});
