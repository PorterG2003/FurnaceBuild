import assert from 'node:assert/strict';
import test from 'node:test';
import { getDisplayBody } from '@furnace/email-lib';
import {
  REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS,
  buildReplyReceivedWebhookPayload,
  buildReplyWebhookBodyText,
  campaignNameFromRelation,
} from './reply-received-webhook-payload.js';

const QUOTED_REPLY = [
  'Thursday works — send a hold.',
  '',
  'On Mon, Jan 5, 2026 at 9:02 AM AEO <aeo@furnaceoutbound.com> wrote:',
  '> Quick check-in for next week',
].join('\n');

test('buildReplyWebhookBodyText strips quoted thread history', () => {
  const bodyText = buildReplyWebhookBodyText(QUOTED_REPLY);
  assert.equal(bodyText, getDisplayBody(QUOTED_REPLY));
  assert.match(bodyText, /Thursday works/);
  assert.doesNotMatch(bodyText, /Quick check-in for next week/);
});

test('buildReplyWebhookBodyText truncates long bodies', () => {
  const bodyText = buildReplyWebhookBodyText('x'.repeat(REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS + 250));
  assert.equal(bodyText.length, REPLY_WEBHOOK_BODY_TEXT_MAX_CHARS);
});

test('buildReplyWebhookBodyText falls back to raw text when display body is empty', () => {
  const raw = '\n\n';
  assert.equal(buildReplyWebhookBodyText(raw), raw);
});

test('campaignNameFromRelation reads object and array joins', () => {
  assert.equal(campaignNameFromRelation({ name: 'Wasatch corridor' }), 'Wasatch corridor');
  assert.equal(campaignNameFromRelation([{ name: 'Wasatch corridor' }]), 'Wasatch corridor');
  assert.equal(campaignNameFromRelation(null), null);
  assert.equal(campaignNameFromRelation({}), null);
});

test('buildReplyReceivedWebhookPayload includes body and identity fields', () => {
  const payload = buildReplyReceivedWebhookPayload({
    threadId: 'thread-1',
    emailMessageId: 'msg-1',
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    leadId: 'lead-1',
    enrollmentId: 'enrollment-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    fromEmail: 'lead@example.com',
    subject: 'Re: Quick check-in',
    bodyText: QUOTED_REPLY,
    receivedAt: '2026-08-23T12:00:00.000Z',
  });

  assert.equal(payload.from_email, 'lead@example.com');
  assert.equal(payload.body_text, getDisplayBody(QUOTED_REPLY));
  assert.notEqual(payload.body_text, payload.subject);
  assert.equal(payload.mailbox_email, 'sender@example.com');
  assert.equal(payload.campaign_name, 'Wasatch corridor');
});

test('buildReplyReceivedWebhookPayload merges identity and keeps from_email', () => {
  const payload = buildReplyReceivedWebhookPayload({
    threadId: 'thread-1',
    emailMessageId: 'msg-1',
    campaignId: 'campaign-1',
    campaignName: 'Wasatch corridor',
    leadId: 'lead-1',
    enrollmentId: 'enrollment-1',
    mailboxId: 'mailbox-1',
    mailboxEmail: 'sender@example.com',
    fromEmail: 'lead@example.com',
    subject: 'Re: Quick check-in',
    bodyText: QUOTED_REPLY,
    receivedAt: '2026-08-23T12:00:00.000Z',
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      company_name: 'Wasatch',
      custom_lead_data: { title: 'VP Sales' },
    },
  });

  assert.equal(payload.from_email, 'lead@example.com');
  assert.equal(payload.email, 'lead@example.com');
  assert.equal(payload.first_name, 'Casey');
  assert.equal(payload.title, 'VP Sales');
});
