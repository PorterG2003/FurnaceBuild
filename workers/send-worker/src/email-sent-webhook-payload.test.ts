import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailSentWebhookPayload } from './email-sent-webhook-payload.js';

test('buildEmailSentWebhookPayload copies lead, mailbox, and campaign identity', () => {
  const payload = buildEmailSentWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    leadId: 'lead-1',
    email: 'lead@example.com',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    providerMessageId: '<abc@example.com>',
    sentAt: '2026-08-23T12:00:00.000Z',
    subject: 'Quick check-in',
  });

  assert.equal(payload.email, 'lead@example.com');
  assert.equal(payload.mailbox_email, 'sender@example.com');
  assert.equal(payload.campaign_name, 'Wasatch corridor');
  assert.equal(payload.lead_id, 'lead-1');
  assert.equal(payload.campaign_id, 'campaign-1');
  assert.equal(payload.mailbox_id, 'mailbox-1');
  assert.equal(payload.message_job_id, 'job-1');
});

test('buildEmailSentWebhookPayload treats blank campaign names as null', () => {
  const payload = buildEmailSentWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: '   ',
    leadId: 'lead-1',
    email: 'lead@example.com',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    sentAt: '2026-08-23T12:00:00.000Z',
    subject: 'Hi',
  });
  assert.equal(payload.campaign_name, null);
  assert.equal(payload.provider_message_id, null);
});
