import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnsubscribeDetectedWebhookPayload } from './unsubscribe-detected-webhook-payload.js';

test('buildUnsubscribeDetectedWebhookPayload includes identity and reply_opt_out source', () => {
  const payload = buildUnsubscribeDetectedWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      company_name: 'Wasatch',
    },
    leadId: 'lead-1',
    enrollmentId: 'enrollment-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
  });

  assert.equal(payload.email, 'lead@example.com');
  assert.equal(payload.mailbox_email, 'sender@example.com');
  assert.equal(payload.campaign_name, 'Wasatch corridor');
  assert.equal(payload.first_name, 'Casey');
  assert.equal(payload.source, 'reply_opt_out');
  assert.equal(payload.enrollment_id, 'enrollment-1');
});
