import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBounceDetectedWebhookPayload } from './bounce-detected-webhook-payload.js';

test('buildBounceDetectedWebhookPayload keeps candidate emails and adds identity', () => {
  const payload = buildBounceDetectedWebhookPayload({
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      last_name: 'Reed',
      company_name: 'Wasatch',
      custom_lead_data: { title: 'VP Sales' },
    },
    leadId: 'lead-1',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    severity: 'hard',
    code: '550',
    bounceMessageId: 'bounce-1',
    bounceUid: 42,
    candidateEmails: ['lead@example.com', 'other@example.com'],
    matchedJobCount: 2,
  });

  assert.equal(payload.email, 'lead@example.com');
  assert.equal(payload.mailbox_email, 'sender@example.com');
  assert.equal(payload.campaign_name, 'Wasatch corridor');
  assert.equal(payload.first_name, 'Casey');
  assert.equal(payload.title, 'VP Sales');
  assert.equal(payload.reason, 'hard 550');
  assert.equal(payload.code, '550');
  assert.deepEqual(payload.candidate_emails, ['lead@example.com', 'other@example.com']);
  assert.equal(payload.matched_job_count, 2);
});

test('buildBounceDetectedWebhookPayload omits email when the lead row is gone', () => {
  const payload = buildBounceDetectedWebhookPayload({
    campaignId: 'campaign-1',
    lead: null,
    leadId: 'lead-1',
    enrollmentId: 'enrollment-1',
    messageJobId: 'job-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    severity: 'soft',
    candidateEmails: ['lead@example.com'],
    matchedJobCount: 1,
  });

  assert.equal('email' in payload, false);
  assert.equal(payload.lead_id, 'lead-1');
  assert.equal(payload.reason, 'soft');
  assert.deepEqual(payload.candidate_emails, ['lead@example.com']);
});
