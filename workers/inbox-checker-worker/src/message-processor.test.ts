import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageProcessor } from './message-processor.js';
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
