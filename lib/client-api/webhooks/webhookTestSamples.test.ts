import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ALLOWED_WEBHOOK_EVENTS } from './webhookEvents.js';
import {
  buildWebhookSamplePreview,
  buildWebhookTestPayload,
  curatedWebhookTestEventOptions,
  isAllowedWebhookEventType,
  WEBHOOK_TEST_EVENT_OPTIONS,
} from './webhookTestSamples.js';

const ctx = {
  accountId: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
};

test('WEBHOOK_TEST_EVENT_OPTIONS cover all allowed webhook events', () => {
  const optionValues = new Set(WEBHOOK_TEST_EVENT_OPTIONS.map((option) => option.value));
  for (const event of DEFAULT_ALLOWED_WEBHOOK_EVENTS) {
    assert.ok(optionValues.has(event), `missing test option for ${event}`);
  }
});

test('buildWebhookTestPayload marks samples as test and matches event shape', () => {
  const emailSent = buildWebhookTestPayload('email.sent', ctx);
  assert.equal(emailSent.test, true);
  assert.equal(emailSent.campaign_id, ctx.campaignId);
  assert.equal(typeof emailSent.subject, 'string');

  const reply = buildWebhookTestPayload('reply.received', ctx);
  assert.equal(reply.test, true);
  assert.equal(reply.from_email, 'lead@example.com');

  const batch = buildWebhookTestPayload('lead.bulk_import.completed', ctx);
  assert.equal(batch.test, true);
  assert.equal(batch.operation, 'api_lead_import');
});

test('buildWebhookSamplePreview omits test flag for live docs', () => {
  const live = buildWebhookSamplePreview('email.sent', ctx, { includeTestFlag: false });
  assert.doesNotMatch(live, /"test": true/);

  const testPreview = buildWebhookSamplePreview('email.sent', ctx, { includeTestFlag: true });
  assert.match(testPreview, /"test": true/);
});

test('isAllowedWebhookEventType rejects unknown values', () => {
  assert.equal(isAllowedWebhookEventType('email.sent'), true);
  assert.equal(isAllowedWebhookEventType('webhook.test'), false);
});

test('curatedWebhookTestEventOptions prioritizes common events and enabled groups', () => {
  const options = curatedWebhookTestEventOptions(['email_activity']);
  const values = options.map((option) => option.value);
  assert.ok(values.includes('email.sent'));
  assert.ok(values.includes('reply.received'));
  assert.equal(values.filter((value) => value === 'email.sent').length, 1);
});
