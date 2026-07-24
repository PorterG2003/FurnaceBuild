import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidHttpsWebhookUrl } from './webhookUrl.js';
import {
  buildWebhookEnvelope,
  buildWebhookSignature,
  deliverWebhookPost,
} from './deliverWebhookPost.js';

test('buildWebhookEnvelope produces standard shape', () => {
  const envelope = buildWebhookEnvelope('email.sent', { subject: 'Hi' }, 'evt-1');
  assert.equal(envelope.id, 'evt-1');
  assert.equal(envelope.type, 'email.sent');
  assert.equal(envelope.data.subject, 'Hi');
  assert.match(envelope.occurred_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('deliverWebhookPost signs payload when secret is set', async (t) => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: HeadersInit | undefined;
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    capturedHeaders = init?.headers;
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await deliverWebhookPost({
    endpointUrl: 'https://webhook-delivery.test/signed',
    signingSecret: 'whsec_test',
    eventType: 'email.sent',
    payload: { test: true },
    deliveryId: 'delivery-1',
    eventId: 'event-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(fetchCalls, 1);
  const headers = capturedHeaders as Record<string, string>;
  assert.match(headers['X-Furnace-Signature'], /^sha256=/);
  assert.equal(headers['X-Furnace-Signature'], buildWebhookSignature('whsec_test', result.requestBody));
});

test('isValidHttpsWebhookUrl accepts public https and rejects private/local', () => {
  const cases: Array<{ url: string; ok: boolean }> = [
    { url: 'https://example.com/hook', ok: true },
    { url: 'https://hooks.example.com/a/b', ok: true },
    { url: 'http://example.com/hook', ok: false },
    { url: 'not-a-url', ok: false },
    { url: 'https://localhost/hooks', ok: false },
    { url: 'https://127.0.0.1/hooks', ok: false },
    { url: 'https://169.254.169.254/latest/meta-data/', ok: false },
    { url: 'https://10.0.0.1/hook', ok: false },
    { url: 'https://192.168.1.1/hook', ok: false },
    { url: 'https://172.16.0.1/hook', ok: false },
    { url: 'https://user:pass@example.com/hook', ok: false },
    { url: 'https://metadata.google.internal/', ok: false },
    // IPv4-mapped IPv6 (Node rewrites dotted form to ::ffff:7f00:1)
    { url: 'https://[::ffff:127.0.0.1]/', ok: false },
    { url: 'https://[::ffff:7f00:1]/', ok: false },
    { url: 'https://[::ffff:10.0.0.1]/', ok: false },
    { url: 'https://[::ffff:a00:1]/', ok: false },
    { url: 'https://[::1]/', ok: false },
  ];
  for (const { url, ok } of cases) {
    assert.equal(isValidHttpsWebhookUrl(url), ok, `${url} (host=${(() => { try { return new URL(url).hostname; } catch { return '?'; } })()})`);
  }
});

test('deliverWebhookPost does not fetch private webhook URLs', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response('ok', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  for (const endpointUrl of [
    'https://127.0.0.1/hooks',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
  ]) {
    fetchCalls = 0;
    const result = await deliverWebhookPost({
      endpointUrl,
      eventType: 'email.sent',
      payload: {},
    });
    assert.equal(result.ok, false, endpointUrl);
    assert.equal(fetchCalls, 0, endpointUrl);
  }
});
