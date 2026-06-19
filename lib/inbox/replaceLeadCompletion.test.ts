import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailMessage } from '@/lib/supabase/types';
import {
  buildReplaceLeadFollowUpAction,
  resolveReplaceLeadForwardMessage,
} from './replaceLeadCompletion';

function message(
  partial: Partial<EmailMessage> & Pick<EmailMessage, 'id' | 'received_at'>
): EmailMessage {
  return {
    id: partial.id,
    thread_id: 'thread-1',
    account_id: 'account-1',
    message_job_id: null,
    direction: 'received',
    from_email: 'sender@example.com',
    from_name: 'Sender',
    to_email: 'team@example.com',
    to_name: null,
    cc: null,
    subject: 'Thread subject',
    body_text: 'Hello',
    body_html: '<p>Hello</p>',
    message_id: `<${partial.id}@example.com>`,
    in_reply_to: null,
    message_references: null,
    received_at: partial.received_at,
    read_at: null,
    headers: {},
    attachments: [],
    imap_uid: null,
    created_at: partial.received_at,
    updated_at: partial.received_at,
    ...partial,
  } as EmailMessage;
}

test('buildReplaceLeadFollowUpAction returns null for replace-only completion', () => {
  assert.equal(
    buildReplaceLeadFollowUpAction({
      intent: 'replace_only',
      forwardTarget: { toEmail: 'new@example.com', toName: 'New Contact' },
    }),
    null,
  );
});

test('buildReplaceLeadFollowUpAction normalizes the forward target', () => {
  assert.deepEqual(
    buildReplaceLeadFollowUpAction({
      intent: 'replace_and_forward',
      preferredForwardMessageId: 'message-123',
      forwardTarget: { toEmail: '  NEW@Example.com ', toName: '  New Contact  ' },
    }),
    {
      kind: 'open_forward_composer',
      preferredForwardMessageId: 'message-123',
      target: {
        toEmail: 'new@example.com',
        toName: 'New Contact',
      },
    },
  );
});

test('resolveReplaceLeadForwardMessage prefers the requested message id when present', () => {
  const early = message({ id: 'early', received_at: '2026-06-01T10:00:00.000Z' });
  const late = message({ id: 'late', received_at: '2026-06-02T10:00:00.000Z' });

  assert.equal(resolveReplaceLeadForwardMessage([early, late], 'early')?.id, 'early');
});

test('resolveReplaceLeadForwardMessage falls back to the latest received message', () => {
  const sent = message({
    id: 'sent',
    direction: 'sent',
    received_at: '2026-06-03T10:00:00.000Z',
  });
  const received = message({
    id: 'received',
    direction: 'received',
    received_at: '2026-06-02T10:00:00.000Z',
  });

  assert.equal(resolveReplaceLeadForwardMessage([sent, received], 'missing')?.id, 'received');
});

test('resolveReplaceLeadForwardMessage falls back to the latest message when no inbound exists', () => {
  const olderSent = message({
    id: 'older-sent',
    direction: 'sent',
    received_at: '2026-06-01T10:00:00.000Z',
  });
  const newerSent = message({
    id: 'newer-sent',
    direction: 'sent',
    received_at: '2026-06-04T10:00:00.000Z',
  });

  assert.equal(resolveReplaceLeadForwardMessage([olderSent, newerSent], null)?.id, 'newer-sent');
});
