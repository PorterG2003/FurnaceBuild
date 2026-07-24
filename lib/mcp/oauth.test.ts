import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetMcpOAuthMemoryForTests,
  assertRegisteredRedirect,
  buildProtectedResourceMetadata,
  handleAuthorize,
  handleOAuthComplete,
  handleRegisterClient,
  handleRevoke,
  oauthAuthorizationServerMetadata,
} from './oauth.js';
import { MCP_SCOPE } from './session.js';

let prevSupabaseUrl: string | undefined;
let prevSupabaseKey: string | undefined;

test.before(() => {
  prevSupabaseUrl = process.env.SUPABASE_URL;
  prevSupabaseKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

test.after(() => {
  if (prevSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = prevSupabaseUrl;
  if (prevSupabaseKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = prevSupabaseKey;
});

test.beforeEach(() => {
  __resetMcpOAuthMemoryForTests();
});

type FakeResponse =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'body'; status: number; body: unknown };

type FakeContextOptions = {
  url?: string;
  headers?: Record<string, string>;
  jsonBody?: unknown;
  formBody?: Record<string, string>;
  contentType?: string;
};

/** Minimal Hono-like context for OAuth handlers. */
function createFakeContext(options: FakeContextOptions = {}) {
  const headers = options.headers ?? {};
  const contentType = options.contentType ?? 'application/json';

  return {
    req: {
      url: options.url ?? 'https://mcp.example.com/oauth/authorize',
      header(name: string) {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        if (key) return headers[key];
        if (name.toLowerCase() === 'content-type') return contentType;
        return undefined;
      },
      async json() {
        return options.jsonBody ?? {};
      },
      async parseBody() {
        return options.formBody ?? {};
      },
    },
    json(body: unknown, status = 200): FakeResponse {
      return { kind: 'json', status, body };
    },
    redirect(location: string, status = 302): FakeResponse {
      return { kind: 'redirect', status, location };
    },
    body(body: unknown, status = 200): FakeResponse {
      return { kind: 'body', status, body };
    },
  };
}

async function registerClient(redirectUris: string[], clientName = 'Test Client') {
  const res = (await handleRegisterClient(
    createFakeContext({
      jsonBody: { client_name: clientName, redirect_uris: redirectUris },
    }),
  )) as FakeResponse;
  assert.equal(res.kind, 'json');
  assert.equal(res.status, 201);
  const body = res.body as { client_id: string; redirect_uris: string[] };
  return body;
}

test('handleRegisterClient registers public client without client_secret', async () => {
  const res = (await handleRegisterClient(
    createFakeContext({
      jsonBody: {
        client_name: 'Cursor',
        redirect_uris: ['https://example.com/callback'],
      },
    }),
  )) as FakeResponse;

  assert.equal(res.kind, 'json');
  assert.equal(res.status, 201);
  const body = res.body as Record<string, unknown>;
  assert.equal(typeof body.client_id, 'string');
  assert.match(String(body.client_id), /^mcp_client_/);
  assert.equal(body.client_secret, undefined);
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.deepEqual(body.redirect_uris, ['https://example.com/callback']);
});

test('handleAuthorize with unregistered redirect_uri returns invalid_request (no redirect)', async () => {
  const registered = await registerClient(['https://example.com/callback']);
  const url = new URL('https://mcp.example.com/oauth/authorize');
  url.searchParams.set('client_id', registered.client_id);
  url.searchParams.set('redirect_uri', 'https://evil.example/steal');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', 'challenge');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'xyz');

  const res = (await handleAuthorize(createFakeContext({ url: url.toString() }))) as FakeResponse;
  assert.equal(res.kind, 'json');
  assert.equal(res.status, 400);
  const body = res.body as { error: string };
  assert.equal(body.error, 'invalid_request');
});

test('handleAuthorize with registered redirect returns 302', async () => {
  const registered = await registerClient(['https://example.com/callback']);
  const url = new URL('https://mcp.example.com/oauth/authorize');
  url.searchParams.set('client_id', registered.client_id);
  url.searchParams.set('redirect_uri', 'https://example.com/callback');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', 'challenge');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 'xyz');

  const res = (await handleAuthorize(createFakeContext({ url: url.toString() }))) as FakeResponse;
  assert.equal(res.kind, 'redirect');
  assert.equal(res.status, 302);
  assert.match(res.location, /\/mcp\/oauth\/consent/);
  assert.match(res.location, /client_id=/);
});

test('handleAuthorize requires S256 PKCE', async () => {
  const registered = await registerClient(['https://example.com/callback']);
  const url = new URL('https://mcp.example.com/oauth/authorize');
  url.searchParams.set('client_id', registered.client_id);
  url.searchParams.set('redirect_uri', 'https://example.com/callback');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', 'challenge');
  url.searchParams.set('code_challenge_method', 'plain');

  const res = (await handleAuthorize(createFakeContext({ url: url.toString() }))) as FakeResponse;
  assert.equal(res.kind, 'json');
  assert.equal(res.status, 400);
  const body = res.body as { error: string; error_description?: string };
  assert.equal(body.error, 'invalid_request');
  assert.match(String(body.error_description ?? ''), /S256/i);
});

test('handleOAuthComplete without JWT returns 401', async () => {
  const registered = await registerClient(['https://example.com/callback']);
  const res = (await handleOAuthComplete(
    createFakeContext({
      jsonBody: {
        client_id: registered.client_id,
        redirect_uri: 'https://example.com/callback',
        code_challenge: 'challenge',
        account_ids: ['11111111-1111-4111-8111-111111111111'],
      },
    }),
  )) as FakeResponse;

  assert.equal(res.kind, 'json');
  assert.equal(res.status, 401);
  const body = res.body as { error: string };
  assert.equal(body.error, 'access_denied');
});

test('handleOAuthComplete with empty account_ids returns 400', async () => {
  const registered = await registerClient(['https://example.com/callback']);
  const res = (await handleOAuthComplete(
    createFakeContext({
      headers: { Authorization: 'Bearer fake-jwt' },
      jsonBody: {
        client_id: registered.client_id,
        redirect_uri: 'https://example.com/callback',
        code_challenge: 'challenge',
        account_ids: [],
      },
    }),
  )) as FakeResponse;

  assert.equal(res.kind, 'json');
  assert.equal(res.status, 400);
  const body = res.body as { error: string; error_description?: string };
  assert.equal(body.error, 'invalid_request');
  assert.match(String(body.error_description ?? ''), /account_ids/i);
});

test('metadata includes revocation_endpoint and furnace.mcp scope', () => {
  const base = 'https://mcp.example.com';
  const as = oauthAuthorizationServerMetadata(base);
  assert.equal(as.issuer, base);
  assert.equal(as.revocation_endpoint, `${base}/oauth/revoke`);
  assert.ok(as.scopes_supported.includes(MCP_SCOPE));
  assert.ok(as.scopes_supported.includes('furnace.mcp'));
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);

  const pr = buildProtectedResourceMetadata(base);
  assert.ok(pr.scopes_supported.includes('furnace.mcp'));
});

test('assertRegisteredRedirect rejects unknown redirect and accepts registered', async () => {
  const registered = await registerClient(['https://example.com/callback']);

  const bad = await assertRegisteredRedirect(registered.client_id, 'https://other.example/cb');
  assert.equal(bad.ok, false);
  if (bad.ok) throw new Error('expected failure');
  assert.equal(bad.error, 'invalid_request');

  const good = await assertRegisteredRedirect(registered.client_id, 'https://example.com/callback');
  assert.equal(good.ok, true);
});

test('handleRevoke returns 200 for unknown token', async () => {
  const res = (await handleRevoke(
    createFakeContext({
      contentType: 'application/json',
      jsonBody: { token: 'mcpu_unknown_token_value' },
    }),
  )) as FakeResponse;

  assert.equal(res.kind, 'body');
  assert.equal(res.status, 200);
  assert.equal(res.body, null);
});
