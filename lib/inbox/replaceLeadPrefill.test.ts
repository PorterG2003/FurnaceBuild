import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplaceLeadPrefill } from './replaceLeadPrefill';

test('buildReplaceLeadPrefill uses high-confidence referral fields when present', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'This reply may be redirecting you to a different contact.',
      suggested_referral: {
        email: ' alt@example.com ',
        firstName: 'Alt',
        lastName: 'Contact',
        confidence: { email: 'high', firstName: 'high', lastName: 'high' },
        filledFields: ['email', 'firstName', 'lastName'],
        reason: 'manual_referral',
      },
      header_mismatch: false,
    },
    inboundFromEmail: 'sender@example.com',
  });

  assert.deepEqual(result, {
    email: 'alt@example.com',
    firstName: 'Alt',
    lastName: 'Contact',
    reason: 'manual_referral',
    reasonNote: 'This reply may be redirecting you to a different contact.',
  });
});

test('buildReplaceLeadPrefill treats legacy referral fields without confidence as high', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'Redirect',
      suggested_referral: {
        email: 'alt@example.com',
        name: 'Alt Contact',
        reason: 'manual_referral',
      },
      header_mismatch: false,
    },
  });

  assert.equal(result?.email, 'alt@example.com');
  assert.equal(result?.name, 'Alt Contact');
  assert.equal(result?.firstName, 'Alt');
  assert.equal(result?.lastName, 'Contact');
});

test('buildReplaceLeadPrefill omits low-confidence referral fields', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'Redirect',
      suggested_referral: {
        email: 'alt@example.com',
        name: 'Support Team',
        confidence: { email: 'high', name: 'low' },
        reason: 'manual_referral',
      },
      header_mismatch: false,
    },
  });

  assert.equal(result?.email, 'alt@example.com');
  assert.equal(result?.name, undefined);
});

test('buildReplaceLeadPrefill falls back to inbound sender for header mismatch', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      primary_message: 'This reply came from a different contact. Consider replacing the lead.',
      suggested_referral: null,
      header_mismatch: true,
    },
    inboundFromEmail: 'new-contact@example.com',
    inboundFromName: 'New Contact',
  });

  assert.deepEqual(result, {
    email: 'new-contact@example.com',
    name: 'New Contact',
    firstName: 'New',
    lastName: 'Contact',
    reason: 'wrong_contact',
    reasonNote: 'This reply came from a different contact. Consider replacing the lead.',
  });
});

test('buildReplaceLeadPrefill maps title into matching custom field keys', () => {
  const result = buildReplaceLeadPrefill({
    metadata: {
      mode: 'manual',
      suggested_referral: {
        email: 'vp@example.com',
        title: 'VP Sales',
        confidence: { email: 'high', title: 'high' },
        reason: 'manual_referral',
      },
      header_mismatch: false,
    },
    customLeadDataKeys: ['Job Title', 'Industry'],
  });

  assert.deepEqual(result?.customFields, { 'Job Title': 'VP Sales' });
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
