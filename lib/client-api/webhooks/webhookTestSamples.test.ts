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
  assert.equal(emailSent.email, 'lead@example.com');
  assert.equal(emailSent.mailbox_email, 'sender@example.com');
  assert.equal(emailSent.campaign_name, 'Example campaign');

  const reply = buildWebhookTestPayload('reply.received', ctx);
  assert.equal(reply.test, true);
  assert.equal(reply.from_email, 'lead@example.com');
  assert.equal(reply.body_text, 'Thursday works — send a hold.');
  assert.equal(reply.mailbox_email, 'sender@example.com');
  assert.equal(reply.campaign_name, 'Example campaign');

  const batch = buildWebhookTestPayload('lead.bulk_import.completed', ctx);
  assert.equal(batch.test, true);
  assert.equal(batch.operation, 'api_lead_import');
});

test('buildWebhookSamplePreview omits test flag for live docs', () => {
  const live = buildWebhookSamplePreview('email.sent', ctx, { includeTestFlag: false });
  assert.doesNotMatch(live, /"test": true/);
  assert.match(live, /"email": "lead@example.com"/);
  assert.match(live, /"mailbox_email": "sender@example.com"/);
  assert.match(live, /"campaign_name": "Example campaign"/);

  const testPreview = buildWebhookSamplePreview('email.sent', ctx, { includeTestFlag: true });
  assert.match(testPreview, /"test": true/);
});

test('isAllowedWebhookEventType rejects unknown values', () => {
  assert.equal(isAllowedWebhookEventType('email.sent'), true);
  assert.equal(isAllowedWebhookEventType('blocklist.entry_added'), true);
  assert.equal(isAllowedWebhookEventType('blocked'), false);
  assert.equal(isAllowedWebhookEventType('webhook.test'), false);
});

test('curatedWebhookTestEventOptions prioritizes common events and enabled types', () => {
  const options = curatedWebhookTestEventOptions(['email.sent', 'reply.categorized']);
  const values = options.map((option) => option.value);
  assert.ok(values.includes('email.sent'));
  assert.ok(values.includes('reply.categorized'));
  assert.equal(values.filter((value) => value === 'email.sent').length, 1);
});

test('buildWebhookTestPayload includes reply.categorized fields', () => {
  const payload = buildWebhookTestPayload('reply.categorized', ctx);
  assert.equal(payload.test, true);
  assert.equal(typeof payload.thread_id, 'string');
  assert.equal(typeof payload.category, 'string');
  assert.ok('previous_category' in payload);
});

test('buildWebhookTestPayload includes blocklist value and type', () => {
  const added = buildWebhookTestPayload('blocklist.entry_added', ctx);
  assert.equal(added.test, true);
  assert.equal(added.value, 'lead@example.com');
  assert.equal(added.type, 'email');
  assert.equal(added.email, 'lead@example.com');
  assert.equal(added.source, 'reply_opt_out');
  assert.equal(added.reason, 'unsubscribed');

  const removed = buildWebhookTestPayload('blocklist.entry_removed', ctx);
  assert.equal(removed.value, 'lead@example.com');
  assert.equal(removed.type, 'email');
  assert.equal(removed.source, 'inbox');
});
