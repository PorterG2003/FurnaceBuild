import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailMessage } from '../supabase/types';
import {
  compareMessagesChronological,
  mergeNewestMessagesPage,
  mergeOlderMessagesPage,
  messageCursorFrom,
  type ThreadMessagesPage,
} from './messagePagination';

function msg(
  id: string,
  receivedAt: string,
  overrides: Partial<EmailMessage> = {},
): EmailMessage {
  return {
    id,
    thread_id: 'thread-1',
    account_id: 'account-1',
    message_job_id: null,
    direction: 'received',
    from_email: 'a@example.com',
    from_name: null,
    to_email: 'b@example.com',
    to_name: null,
    to_emails: null,
    cc: null,
    subject: 'Subject',
    body_text: `body-${id}`,
    body_html: null,
    message_id: null,
    in_reply_to: null,
    message_references: null,
    reference_message_ids: null,
    thread_topic: null,
    thread_index: null,
    conversation_root_message_id: null,
    received_at: receivedAt,
    read_at: null,
    headers: {},
    attachments: [],
    imap_uid: null,
    parse_version: 1,
    search_vector: null,
    created_at: receivedAt,
    updated_at: receivedAt,
    ...overrides,
  };
}

function pageOf(messages: EmailMessage[], hasOlder: boolean): ThreadMessagesPage {
  const chronological = [...messages].sort(compareMessagesChronological);
  return {
    messages: chronological,
    hasOlder,
    oldestCursor: chronological[0] ? messageCursorFrom(chronological[0]) : null,
    newestCursor:
      chronological.length > 0
        ? messageCursorFrom(chronological[chronological.length - 1]!)
        : null,
  };
}

test('compareMessagesChronological orders by received_at then id', () => {
  const a = msg('a', '2026-01-01T00:00:00.000Z');
  const b = msg('b', '2026-01-01T00:00:00.000Z');
  const c = msg('c', '2026-01-02T00:00:00.000Z');
  assert.ok(compareMessagesChronological(a, b) < 0);
  assert.ok(compareMessagesChronological(b, a) > 0);
  assert.ok(compareMessagesChronological(a, c) < 0);
});

test('mergeOlderMessagesPage prepends without duplicates', () => {
  const newer = [msg('m3', '2026-01-03T00:00:00.000Z'), msg('m4', '2026-01-04T00:00:00.000Z')];
  const olderPage = pageOf(
    [msg('m1', '2026-01-01T00:00:00.000Z'), msg('m2', '2026-01-02T00:00:00.000Z'), msg('m3', '2026-01-03T00:00:00.000Z')],
    true,
  );
  const merged = mergeOlderMessagesPage(newer, olderPage);
  assert.deepEqual(
    merged.messages.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4'],
  );
  assert.equal(merged.hasOlder, true);
  assert.deepEqual(merged.oldestCursor, { receivedAt: '2026-01-01T00:00:00.000Z', id: 'm1' });
});

test('mergeNewestMessagesPage keeps previously loaded older history', () => {
  const existing = [
    msg('m1', '2026-01-01T00:00:00.000Z'),
    msg('m2', '2026-01-02T00:00:00.000Z'),
    msg('m3', '2026-01-03T00:00:00.000Z'),
    msg('m4', '2026-01-04T00:00:00.000Z'),
  ];
  const newestPage = pageOf(
    [msg('m3', '2026-01-03T00:00:00.000Z'), msg('m4', '2026-01-04T00:00:00.000Z'), msg('m5', '2026-01-05T00:00:00.000Z')],
    true,
  );
  const merged = mergeNewestMessagesPage(existing, newestPage, true);
  assert.deepEqual(
    merged.messages.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4', 'm5'],
  );
  assert.equal(merged.hasOlder, true);
});

test('mergeNewestMessagesPage collapses to single page when hasOlder is false', () => {
  const existing = [
    msg('old', '2026-01-01T00:00:00.000Z'),
    msg('m1', '2026-01-02T00:00:00.000Z'),
  ];
  const newestPage = pageOf([msg('m1', '2026-01-02T00:00:00.000Z')], false);
  const merged = mergeNewestMessagesPage(existing, newestPage, true);
  assert.deepEqual(
    merged.messages.map((m) => m.id),
    ['m1'],
  );
  assert.equal(merged.hasOlder, false);
});
