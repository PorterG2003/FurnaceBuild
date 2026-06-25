import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWebhookEnvelope,
  buildWebhookSignature,
  deliverWebhookPost,
  isValidHttpsWebhookUrl,
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
  globalThis.fetch = async (_input, init) => {
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
  const headers = capturedHeaders as Record<string, string>;
  assert.match(headers['X-Furnace-Signature'], /^sha256=/);
  assert.equal(headers['X-Furnace-Signature'], buildWebhookSignature('whsec_test', result.requestBody));
});

test('isValidHttpsWebhookUrl accepts https only', () => {
  assert.equal(isValidHttpsWebhookUrl('https://example.com/hook'), true);
  assert.equal(isValidHttpsWebhookUrl('http://example.com/hook'), false);
  assert.equal(isValidHttpsWebhookUrl('not-a-url'), false);
});
