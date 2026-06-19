import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplaceLeadPrefill } from './replaceLeadPrefill';

test('buildReplaceLeadPrefill uses suggested referral details when present', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'This reply may be redirecting you to a different contact.',
      suggested_referral: {
        email: ' alt@example.com ',
        name: 'Alt Contact',
        reason: 'manual_referral',
      },
      header_mismatch: false,
    },
    inboundFromEmail: 'sender@example.com',
  });

  assert.deepEqual(result, {
    email: 'alt@example.com',
    name: 'Alt Contact',
    reason: 'manual_referral',
    reasonNote: 'This reply may be redirecting you to a different contact.',
  });
});

test('buildReplaceLeadPrefill falls back to inbound sender for header mismatch', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'This reply came from a different contact. Consider replacing the lead.',
      suggested_referral: {
        email: null,
        name: null,
        reason: null,
      },
      header_mismatch: true,
    },
    inboundFromEmail: 'new-contact@example.com',
  });

  assert.deepEqual(result, {
    email: 'new-contact@example.com',
    name: null,
    reason: 'wrong_contact',
    reasonNote: 'This reply came from a different contact. Consider replacing the lead.',
  });
});

test('buildReplaceLeadPrefill returns null without referral context', () => {
  assert.equal(
    buildReplaceLeadPrefill({
      metadata: {
        mode: 'manual',
        primary_message: null,
        suggested_referral: null,
        header_mismatch: false,
      },
      inboundFromEmail: 'sender@example.com',
    }),
    null
  );
});
