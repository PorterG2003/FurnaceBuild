import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailThread } from '@/lib/supabase/types';
import { resolveSelectedThread } from './resolveSelectedThread';

function thread(id: string): EmailThread {
  return {
    id,
    account_id: 'account-1',
    mailbox_id: 'mailbox-1',
    campaign_id: null,
    lead_id: 'lead-1',
    subject: 'Subject',
    conversation_status: 'open',
    conversation_status_source: null,
    category: null,
    category_source: null,
    has_reply: true,
    last_message_at: '2026-01-01T00:00:00.000Z',
    last_inbound_at: '2026-01-01T00:00:00.000Z',
    handling_metadata: null,
    out_of_office: false,
    ooo_resume_at: null,
    ooo_resume_requested: false,
    ooo_resume_processed_at: null,
    smartlead_lead_id: null,
    classification_status: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test('resolveSelectedThread returns undefined when no selected id', () => {
  assert.equal(resolveSelectedThread([thread('a')], null, thread('b')), undefined);
});

test('resolveSelectedThread prefers the thread from the list', () => {
  const listThread = thread('selected');
  const fetchedThread = { ...listThread, subject: 'Fetched subject' };

  assert.equal(resolveSelectedThread([listThread], 'selected', fetchedThread), listThread);
});

test('resolveSelectedThread falls back to fetched thread when missing from list', () => {
  const fetchedThread = thread('selected');

  assert.equal(resolveSelectedThread([], 'selected', fetchedThread), fetchedThread);
});

test('resolveSelectedThread returns undefined when missing from list and no fallback', () => {
  assert.equal(resolveSelectedThread([], 'selected', null), undefined);
});
