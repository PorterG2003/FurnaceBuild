import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRecommendation,
  classifyDbJob,
  completedMailboxIdsFromResults,
  dedupeMailboxResults,
  extractCampaignSubject,
  extractLeadEmail,
  heuristicMatchJobInSentEntries,
  isIncompleteMailboxResult,
  matchJobInSentIndex,
  normalizeMessageId,
  type CampaignJobSnapshot,
  type SentIndexEntry,
} from './campaignSendIntegrity.js';

function job(overrides: Partial<CampaignJobSnapshot> = {}): CampaignJobSnapshot {
  return {
    id: 'job-1',
    status: 'sent',
    status_reason: 'sent_successfully',
    mailbox_id: 'mailbox-1',
    enrollment_id: 'enrollment-1',
    lead_id: 'lead-1',
    provider_message_id: '<provider@mail.test>',
    sent_at: '2026-06-10T12:00:00.000Z',
    sending_started_at: '2026-06-10T11:59:00.000Z',
    created_at: '2026-06-10T11:58:00.000Z',
    message_data: {
      lead_data: { email: 'lead@example.com' },
      node_config: { subject: 'Quick question' },
    },
    ...overrides,
  };
}

describe('campaignSendIntegrity helpers', () => {
  it('normalizes message ids', () => {
    assert.equal(normalizeMessageId('<ABC@mail.test>'), 'abc@mail.test');
  });

  it('extracts lead email and subject from campaign message_data', () => {
    const messageData = {
      lead_data: { email: 'Lead@Example.com' },
      node_config: { subject: 'Hello there' },
    };
    assert.equal(extractLeadEmail(messageData), 'lead@example.com');
    assert.equal(extractCampaignSubject(messageData), 'Hello there');
  });

  it('classifies healthy and suspect DB jobs', () => {
    assert.equal(classifyDbJob(job()), 'healthy_sent');
    assert.equal(classifyDbJob(job({ provider_message_id: null })), 'sent_missing_provider_id');
    assert.equal(classifyDbJob(job({ sent_at: null })), 'sent_missing_sent_at');
    assert.equal(
      classifyDbJob(job({ status: 'failed', status_reason: 'uncertain_send_state' })),
      'failed_uncertain_send_state',
    );
  });

  it('matches jobs in sent index by x-message-id and provider id', () => {
    const entry: SentIndexEntry = {
      uid: 42,
      messageId: '<provider@mail.test>',
      normalizedMessageId: 'provider@mail.test',
      xMessageId: 'job-1',
      subject: 'Quick question',
      toEmails: ['lead@example.com'],
      date: '2026-06-10T12:00:00.000Z',
    };
    const index = {
      byXMessageId: new Map([['job-1', entry]]),
      byProviderMessageId: new Map([['provider@mail.test', entry]]),
    };

    const byX = matchJobInSentIndex(job(), index);
    assert.equal(byX.bucket, 'db_sent_and_imap_confirmed');
    assert.equal(byX.matchedBy, 'x-message-id');

    const byProvider = matchJobInSentIndex(job({ id: 'job-2' }), index);
    assert.equal(byProvider.bucket, 'db_sent_and_imap_confirmed');
    assert.equal(byProvider.matchedBy, 'provider_message_id');
  });

  it('heuristically matches campaign sends by to/subject/time window', () => {
    const entries: SentIndexEntry[] = [
      {
        uid: 99,
        messageId: '<other@mail.test>',
        normalizedMessageId: 'other@mail.test',
        xMessageId: null,
        subject: 'Quick question',
        toEmails: ['lead@example.com'],
        date: '2026-06-10T12:01:00.000Z',
      },
    ];
    assert.ok(heuristicMatchJobInSentEntries(job({ id: 'missing-job' }), entries));
  });

  it('builds recommendation levels from anomaly counts', () => {
    assert.equal(
      buildRecommendation({
        sentCampaignJobs: 1000,
        dbSuspectCount: 1,
        imapMissingMatchCount: 0,
        uncertainFailedCount: 2,
        uncertainButFoundInImapCount: 0,
      }).level,
      'low_risk',
    );
    assert.equal(
      buildRecommendation({
        sentCampaignJobs: 1000,
        dbSuspectCount: 25,
        imapMissingMatchCount: 0,
        uncertainFailedCount: 0,
        uncertainButFoundInImapCount: 0,
      }).level,
      'investigate_mailboxes',
    );
  });

  it('dedupes mailbox results and drops timeout-only rows from completed ids', () => {
    const results = [
      {
        mailbox_id: 'a',
        scanned_sent_messages: 0,
        confirmed: 0,
        errors: ['Mailbox audit timed out after 180000ms'],
      },
      {
        mailbox_id: 'a',
        scanned_sent_messages: 100,
        confirmed: 99,
        errors: [],
      },
      {
        mailbox_id: 'b',
        scanned_sent_messages: 0,
        confirmed: 0,
        errors: ['Mailbox audit timed out after 180000ms'],
      },
    ];
    const deduped = dedupeMailboxResults(results);
    assert.equal(deduped.length, 2);
    assert.equal(deduped.find((row) => row.mailbox_id === 'a')?.confirmed, 99);
    assert.deepEqual(completedMailboxIdsFromResults(deduped), ['a']);
  });

  it('treats partial IMAP scans with connection errors as incomplete', () => {
    const partial = {
      mailbox_id: 'c',
      scanned_sent_messages: 245,
      confirmed: 47,
      missing_imap_match: 114,
      jobs_checked: 161,
      errors: ['uid 15367: Connection not available'],
    };
    assert.equal(isIncompleteMailboxResult(partial), true);
    assert.deepEqual(completedMailboxIdsFromResults([partial]), []);

    const complete = {
      mailbox_id: 'c',
      scanned_sent_messages: 756,
      confirmed: 160,
      missing_imap_match: 0,
      jobs_checked: 160,
      errors: [],
    };
    assert.equal(isIncompleteMailboxResult(complete), false);
    assert.equal(
      dedupeMailboxResults([partial, complete]).find((row) => row.mailbox_id === 'c')?.confirmed,
      160,
    );
  });
});
