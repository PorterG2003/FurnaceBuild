import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProxyFailureForTool, proxyClientApi } from './proxy.js';

test('proxy forwards Authorization and Idempotency-Key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await proxyClientApi(
    { baseUrl: 'https://api.example.com', fetchImpl, timeoutMs: 5_000 },
    {
      method: 'post',
      path: '/v1/campaigns',
      body: { name: 'Test' },
      authorization: 'Bearer f_testkey',
      idempotencyKey: 'idem-1',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer f_testkey');
  assert.equal(headers.get('Idempotency-Key'), 'idem-1');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('X-Furnace-Account-Id'), null);
  assert.match(calls[0].url, /https:\/\/api\.example\.com\/v1\/campaigns/);
});

test('proxy sets X-Furnace-Account-Id when accountId provided and omits when not', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const withAccount = await proxyClientApi(
    { baseUrl: 'https://api.example.com', fetchImpl },
    {
      method: 'get',
      path: '/v1/campaigns',
      authorization: 'Bearer mcpu_test',
      accountId: '11111111-1111-4111-8111-111111111111',
    },
  );
  assert.equal(withAccount.ok, true);
  assert.equal(
    new Headers(calls[0].init.headers).get('X-Furnace-Account-Id'),
    '11111111-1111-4111-8111-111111111111',
  );

  const withoutAccount = await proxyClientApi(
    { baseUrl: 'https://api.example.com', fetchImpl },
    {
      method: 'get',
      path: '/v1/campaigns',
      authorization: 'Bearer f_key',
    },
  );
  assert.equal(withoutAccount.ok, true);
  assert.equal(new Headers(calls[1].init.headers).get('X-Furnace-Account-Id'), null);
});

test('proxy maps 401/404/429 to structured failures', async () => {
  for (const status of [401, 404, 429] as const) {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: `fail-${status}`, code: `c${status}` } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await proxyClientApi(
      { baseUrl: 'https://api.example.com', fetchImpl },
      {
        method: 'get',
        path: '/v1/campaigns',
        authorization: 'f_key',
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) throw new Error('expected failure');
    assert.equal(result.status, status);
    assert.equal(result.error.status, status);
    assert.match(result.error.message, new RegExp(`fail-${status}`));
    assert.equal(result.error.code, `c${status}`);
    assert.ok(result.error.bodySnippet);
  }
});

test('proxy omits HTML gateway bodies from failure snippets', async () => {
  const html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<HTML><HEAD><TITLE>ERROR</TITLE></HEAD><BODY><H1>400 ERROR</H1></BODY></HTML>`;
  const fetchImpl: typeof fetch = async () =>
    new Response(html, {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });

  const result = await proxyClientApi(
    { baseUrl: 'https://api.example.com', fetchImpl },
    {
      method: 'get',
      path: '/v1/campaigns/..%2Fetc',
      authorization: 'Bearer f_key',
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.error.status, 400);
  assert.equal(result.error.bodySnippet, undefined);
  const formatted = formatProxyFailureForTool(result);
  assert.match(formatted, /Client API error 400/);
  assert.doesNotMatch(formatted, /<!DOCTYPE/i);
  assert.doesNotMatch(formatted, /<html/i);
});

test('formatProxyFailureForTool keeps JSON error snippets', () => {
  const formatted = formatProxyFailureForTool({
    ok: false,
    status: 404,
    error: {
      message: 'Campaign not found',
      status: 404,
      code: 'campaign_not_found',
      bodySnippet: '{"error":{"code":"campaign_not_found"}}',
    },
  });
  assert.match(formatted, /campaign_not_found/);
  assert.match(formatted, /Campaign not found/);
});

test('proxy abort/timeout returns 504 tool-shaped error', async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const result = await proxyClientApi(
    { baseUrl: 'https://api.example.com', fetchImpl, timeoutMs: 20 },
    {
      method: 'get',
      path: '/v1/campaigns',
      authorization: 'Bearer f_key',
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.error.status, 504);
  assert.equal(result.error.code, 'timeout');
});
