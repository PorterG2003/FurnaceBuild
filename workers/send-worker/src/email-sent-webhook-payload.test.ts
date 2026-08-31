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

test('buildEmailSentWebhookPayload merges contact fields, body, and step', () => {
  const payload = buildEmailSentWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    leadId: 'lead-1',
    email: 'lead@example.com',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    sentAt: '2026-08-23T12:00:00.000Z',
    subject: 'Quick check-in',
    bodyText: 'Hi Casey',
    stepNumber: 2,
    nodeId: 'node-1',
    flowNodeId: 'email-2',
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      last_name: 'Reed',
      company_name: 'Wasatch',
      custom_lead_data: { title: 'VP Sales' },
    },
  });

  assert.equal(payload.first_name, 'Casey');
  assert.equal(payload.company_name, 'Wasatch');
  assert.equal(payload.title, 'VP Sales');
  assert.equal(payload.body_text, 'Hi Casey');
  assert.equal(payload.step_number, 2);
  assert.equal(payload.node_id, 'node-1');
  assert.equal(payload.flow_node_id, 'email-2');
});

test('buildEmailSentWebhookPayload omits step_number when message_data lacks it', () => {
  const payload = buildEmailSentWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    leadId: 'lead-1',
    email: 'lead@example.com',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    sentAt: '2026-08-23T12:00:00.000Z',
    subject: 'Hi',
    bodyText: 'x'.repeat(16_250),
  });
  assert.equal('step_number' in payload, false);
  assert.equal(payload.body_text?.length, 16_000);
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
