import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoReplyMessage, MessageProcessor } from './message-processor.js';
import type { ProcessedMessage } from './types.js';

function createProcessedMessage(overrides: Partial<ProcessedMessage> = {}): ProcessedMessage {
  return {
    uid: 123,
    messageId: '<reply@example.com>',
    inReplyTo: null,
    references: null,
    from: { address: 'lead@example.com', name: 'Lead' },
    to: [{ address: 'sender@example.com', name: 'Sender' }],
    subject: 'Re: Hello',
    bodyText: 'Reply body',
    bodyHtml: null,
    date: new Date('2026-04-06T02:58:50.000Z'),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

test('detects RFC 3834 Auto-Submitted variants', () => {
  assert.equal(isAutoReplyMessage({ 'auto-submitted': 'auto-replied' }), true);
  assert.equal(isAutoReplyMessage({ 'auto-submitted': 'auto-generated' }), true);
  assert.equal(isAutoReplyMessage({ 'auto-submitted': 'AUTO-REPLIED' }), true);
  assert.equal(isAutoReplyMessage({ 'auto-submitted': '  auto-replied  ' }), true);
});

test('Auto-Submitted: no explicitly means a human sent it', () => {
  assert.equal(isAutoReplyMessage({ 'auto-submitted': 'no' }), false);
  assert.equal(isAutoReplyMessage({ 'auto-submitted': 'No' }), false);
});

test('detects vendor autoresponder headers regardless of value', () => {
  assert.equal(isAutoReplyMessage({ 'x-autoreply': 'yes' }), true);
  assert.equal(isAutoReplyMessage({ 'x-autoreply': '' }), true);
  assert.equal(isAutoReplyMessage({ 'x-autorespond': 'vacation' }), true);
});

test('detects Precedence: auto_reply but not bulk/list precedence', () => {
  assert.equal(isAutoReplyMessage({ precedence: 'auto_reply' }), true);
  assert.equal(isAutoReplyMessage({ precedence: 'AUTO_REPLY' }), true);
  // bulk/list mark mailing lists, not autoresponders - they must not park
  // real outbound as OOO.
  assert.equal(isAutoReplyMessage({ precedence: 'bulk' }), false);
  assert.equal(isAutoReplyMessage({ precedence: 'list' }), false);
});

test('handles array header values (first value wins)', () => {
  assert.equal(isAutoReplyMessage({ 'auto-submitted': ['auto-replied', 'no'] }), true);
  assert.equal(isAutoReplyMessage({ 'auto-submitted': ['no', 'auto-replied'] }), false);
});

test('plain human replies are not flagged', () => {
  assert.equal(isAutoReplyMessage({}), false);
  assert.equal(
    isAutoReplyMessage({
      'message-id': '<abc@example.com>',
      'in-reply-to': '<def@example.com>',
      'content-type': 'text/plain',
    }),
    false,
  );
  assert.equal(isAutoReplyMessage({ 'auto-submitted': undefined }), false);

test('isReply returns true when In-Reply-To is present', () => {
  const processor = new MessageProcessor();
  assert.equal(
    processor.isReply(createProcessedMessage({ inReplyTo: '<parent@example.com>' })),
    true,
  );
});

test('isReply returns true when References is present without In-Reply-To', () => {
  const processor = new MessageProcessor();
  assert.equal(
    processor.isReply(
      createProcessedMessage({
        references: '<parent@example.com>',
      }),
    ),
    true,
  );
});

test('isReply returns true when both threading headers are present', () => {
  const processor = new MessageProcessor();
  assert.equal(
    processor.isReply(
      createProcessedMessage({
        inReplyTo: '<parent@example.com>',
        references: '<parent@example.com> <older@example.com>',
      }),
    ),
    true,
  );
});

test('isReply returns false when neither threading header is present', () => {
  const processor = new MessageProcessor();
  assert.equal(processor.isReply(createProcessedMessage()), false);
});

test('isReply returns false when threading headers are whitespace only', () => {
  const processor = new MessageProcessor();
  assert.equal(
    processor.isReply(
      createProcessedMessage({
        inReplyTo: '   ',
        references: '\t',
      }),
    ),
    false,
  );
});
