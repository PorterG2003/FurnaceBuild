import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoReplyMessage } from './message-processor.js';

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
});
