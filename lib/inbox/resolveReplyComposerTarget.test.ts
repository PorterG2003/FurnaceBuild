import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReplyComposerTarget } from './resolveReplyComposerTarget';

test('resolveReplyComposerTarget prefers the current replacement lead when present', () => {
  const result = resolveReplyComposerTarget({
    message: {
      direction: 'received',
      from_email: 'old.lead@example.com',
      from_name: 'Old Lead',
    },
    lastReceived: null,
    currentLeadEmail: 'new.lead@example.com',
    currentLeadName: 'New Lead',
  });

  assert.deepEqual(result, {
    toEmail: 'new.lead@example.com',
    toName: 'New Lead',
  });
});

test('resolveReplyComposerTarget falls back to the received message sender when there is no current lead', () => {
  const result = resolveReplyComposerTarget({
    message: {
      direction: 'received',
      from_email: 'old.lead@example.com',
      from_name: 'Old Lead',
    },
    lastReceived: null,
    currentLeadEmail: null,
    currentLeadName: null,
  });

  assert.deepEqual(result, {
    toEmail: 'old.lead@example.com',
    toName: 'Old Lead',
  });
});

test('resolveReplyComposerTarget falls back to the last received message for sent messages', () => {
  const result = resolveReplyComposerTarget({
    message: {
      direction: 'sent',
      from_email: 'mailbox@example.com',
      from_name: 'Mailbox',
    },
    lastReceived: {
      from_email: 'old.lead@example.com',
      from_name: 'Old Lead',
    },
    currentLeadEmail: null,
    currentLeadName: null,
  });

  assert.deepEqual(result, {
    toEmail: 'old.lead@example.com',
    toName: 'Old Lead',
  });
});

test('resolveReplyComposerTarget trims whitespace and treats empty current lead values as missing', () => {
  const result = resolveReplyComposerTarget({
    message: {
      direction: 'received',
      from_email: ' old.lead@example.com ',
      from_name: ' Old Lead ',
    },
    lastReceived: null,
    currentLeadEmail: '   ',
    currentLeadName: '   ',
  });

  assert.deepEqual(result, {
    toEmail: 'old.lead@example.com',
    toName: 'Old Lead',
  });
});

test('resolveReplyComposerTarget keeps an empty name when only the current lead email is known', () => {
  const result = resolveReplyComposerTarget({
    message: {
      direction: 'received',
      from_email: 'old.lead@example.com',
      from_name: 'Old Lead',
    },
    lastReceived: null,
    currentLeadEmail: 'new.lead@example.com',
    currentLeadName: '   ',
  });

  assert.deepEqual(result, {
    toEmail: 'new.lead@example.com',
    toName: '',
  });
});
