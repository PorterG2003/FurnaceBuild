import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailMessage, EmailThread, Lead } from '@/lib/supabase/types';
import { buildInboxInteractionContext, extractSuggestionVersion } from './buildInboxInteractionContext';
import { resolveSuggestionVersion } from './smartHandlingVersion';

function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: 'thread-1',
    account_id: 'account-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    enrollment_id: null,
    message_job_id: null,
    mailbox_id: null,
    smartlead_lead_id: null,
    subject: 'Re: Intro',
    participants: ['team@example.com', 'lead@example.com'],
    last_message_at: '2026-06-22T18:00:00.000Z',
    last_inbound_at: '2026-06-22T18:00:00.000Z',
    message_count: 2,
    has_reply: true,
    category: 'Interested',
    category_source: 'user',
    conversation_status: 'open',
    conversation_status_source: 'system',
    classification_status: 'complete',
    classification_requested_at: null,
    classification_completed_at: '2026-06-22T18:00:00.000Z',
    handling_metadata: {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category: 'Interested',
    },
    out_of_office: false,
    ooo_resume_requested: false,
    ooo_resume_at: null,
    ooo_resume_processed_at: null,
    created_at: '2026-06-22T17:00:00.000Z',
    updated_at: '2026-06-22T18:00:00.000Z',
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    account_id: 'account-1',
    campaign_id: 'campaign-1',
    global_lead_id: null,
    email: 'lead@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    company_name: 'Analytical Engines',
    title: null,
    phone_number: null,
    linkedin_url: null,
    company_linkedin_url: null,
    website: null,
    custom_lead_data: {},
    display_name: 'Ada Lovelace',
    smartlead_id: null,
    created_at: '2026-06-22T17:00:00.000Z',
    updated_at: '2026-06-22T18:00:00.000Z',
    ...overrides,
  } as Lead;
}

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'message-1',
    thread_id: 'thread-1',
    account_id: 'account-1',
    message_job_id: null,
    direction: 'received',
    from_email: 'lead@example.com',
    from_name: 'Ada Lovelace',
    to_email: 'team@example.com',
    to_name: null,
    to_emails: null,
    cc: null,
    subject: 'Re: Intro',
    body_text: null,
    body_html: '<p>Hello <b>team</b></p>',
    message_id: null,
    in_reply_to: null,
    message_references: null,
    reference_message_ids: null,
    thread_topic: null,
    thread_index: null,
    received_at: '2026-06-22T18:00:00.000Z',
    read_at: null,
    headers: {},
    attachments: [],
    imap_uid: null,
    parse_version: 1,
    search_vector: null,
    created_at: '2026-06-22T18:00:00.000Z',
    updated_at: '2026-06-22T18:00:00.000Z',
    ...overrides,
  };
}

test('buildInboxInteractionContext builds a trimmed snapshot with preview text', () => {
  const context = buildInboxInteractionContext({
    thread: makeThread(),
    lead: makeLead(),
    triggerMessage: makeMessage(),
  });

  assert.deepEqual(context, {
    thread: {
      id: 'thread-1',
      account_id: 'account-1',
      campaign_id: 'campaign-1',
      lead_id: 'lead-1',
      category: 'Interested',
      category_source: 'user',
      conversation_status: 'open',
      conversation_status_source: 'system',
      classification_status: 'complete',
      classification_completed_at: '2026-06-22T18:00:00.000Z',
      handling_metadata: {
        mode: 'manual',
        suggestion_version: resolveSuggestionVersion('manual'),
        category: 'Interested',
      },
      out_of_office: false,
      ooo_resume_requested: false,
      ooo_resume_at: null,
      ooo_resume_processed_at: null,
    },
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_name: 'Analytical Engines',
    },
    trigger_message: {
      id: 'message-1',
      subject: 'Re: Intro',
      from_email: 'lead@example.com',
      from_name: 'Ada Lovelace',
      body_preview: 'Hello team',
    },
  });
});

test('buildInboxInteractionContext handles null lead and missing thread', () => {
  assert.equal(buildInboxInteractionContext({ thread: null }), null);

  const context = buildInboxInteractionContext({
    thread: makeThread(),
    lead: null,
    triggerMessage: null,
  });
  assert.equal(context?.lead, null);
  assert.equal(context?.trigger_message, null);
});

test('extractSuggestionVersion returns nulls when metadata is absent', () => {
  assert.deepEqual(extractSuggestionVersion(null), {
    suggestion_mode: null,
    suggestion_version: null,
  });
});
