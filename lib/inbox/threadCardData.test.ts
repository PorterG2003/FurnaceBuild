import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildThreadSnippetMap,
  resolveThreadCardTitle,
  resolveThreadRecipientEmail,
} from './threadCardData';

test('resolveThreadRecipientEmail prefers the current lead email', () => {
  const result = resolveThreadRecipientEmail({
    thread: { participants: ['mailbox@example.com', 'old.lead@example.com'] },
    leadEmail: 'new.lead@example.com',
    mailboxEmail: 'mailbox@example.com',
  });

  assert.equal(result, 'new.lead@example.com');
});

test('resolveThreadRecipientEmail skips the mailbox email and returns the first prospect email', () => {
  const result = resolveThreadRecipientEmail({
    thread: { participants: ['mailbox@example.com', 'lead@example.com', 'cc@example.com'] },
    leadEmail: null,
    mailboxEmail: 'mailbox@example.com',
  });

  assert.equal(result, 'lead@example.com');
});

test('resolveThreadCardTitle prefers the lead display name before email fallbacks', () => {
  const result = resolveThreadCardTitle({
    thread: { participants: ['mailbox@example.com', 'lead@example.com'] },
    leadDisplayName: 'Jane Prospect',
    leadEmail: 'lead@example.com',
    mailboxEmail: 'mailbox@example.com',
    subject: 'Re: Checking in',
  });

  assert.equal(result, 'Jane Prospect');
});

test('resolveThreadCardTitle falls back to the prospect email when no lead name is available', () => {
  const result = resolveThreadCardTitle({
    thread: { participants: ['mailbox@example.com', 'lead@example.com'] },
    leadDisplayName: '   ',
    leadEmail: null,
    mailboxEmail: 'mailbox@example.com',
    subject: 'Re: Checking in',
  });

  assert.equal(result, 'lead@example.com');
});

test('buildThreadSnippetMap prefers the latest received message over a newer sent message', () => {
  const result = buildThreadSnippetMap([
    {
      thread_id: 'thread-1',
      direction: 'sent',
      body_text: 'Latest outbound follow-up',
      body_html: null,
    },
    {
      thread_id: 'thread-1',
      direction: 'received',
      body_text: 'Prospect reply that should show in preview',
      body_html: null,
    },
  ]);

  assert.equal(result['thread-1'], 'Prospect reply that should show in preview');
});

test('buildThreadSnippetMap falls back to the latest sent message when there is no received reply', () => {
  const result = buildThreadSnippetMap([
    {
      thread_id: 'thread-1',
      direction: 'sent',
      body_text: 'Latest outbound follow-up',
      body_html: null,
    },
  ]);

  assert.equal(result['thread-1'], 'Latest outbound follow-up');
});

test('buildThreadSnippetMap skips blank snippets and keeps the first non-empty preview', () => {
  const result = buildThreadSnippetMap([
    {
      thread_id: 'thread-1',
      direction: 'received',
      body_text: '   ',
      body_html: null,
    },
    {
      thread_id: 'thread-1',
      direction: 'received',
      body_text: 'Earlier non-empty reply',
      body_html: null,
    },
  ]);

  assert.equal(result['thread-1'], 'Earlier non-empty reply');
});
