import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSuggestedReferralFromExtraction,
  extractReferralContactHeuristic,
  isHighConfidencePersonName,
  mapTitleToCustomFields,
  referralHasHighConfidenceName,
  splitPersonName,
} from './referralContactExtraction';

test('splitPersonName splits first and remainder', () => {
  assert.deepEqual(splitPersonName('Kathleen Borthwick'), {
    firstName: 'Kathleen',
    lastName: 'Borthwick',
  });
});

test('extractReferralContactHeuristic extracts email and first/last for Passage Bio pattern', () => {
  const result = extractReferralContactHeuristic({
    fromEmail: 'rmastropietro_c@passagebio.com',
    leadEmail: 'rmastropietro@passagebio.com',
    bodyText:
      'Rich Mastropietro is no longer with Passage Bio. Please contact Kathleen Borthwick at kborthwick@passagebio.com with any inquiries.',
  });

  assert.equal(result.fields.email, 'kborthwick@passagebio.com');
  assert.equal(result.fields.name, 'Kathleen Borthwick');
  assert.equal(result.fields.firstName, 'Kathleen');
  assert.equal(result.fields.lastName, 'Borthwick');
  assert.deepEqual(result.filledFields, ['email', 'name', 'firstName', 'lastName']);
});

test('extractReferralContactHeuristic supports email-only redirect', () => {
  const result = extractReferralContactHeuristic({
    fromEmail: 'mboury@lumafintech.com',
    leadEmail: 'mboury@lumafintech.com',
    bodyText: 'Please reach out to clientservice.eu@lumafintech.com for assistance.',
  });

  assert.equal(result.fields.email, 'clientservice.eu@lumafintech.com');
  assert.equal(result.fields.name, undefined);
  assert.deepEqual(result.filledFields, ['email']);
});

test('extractReferralContactHeuristic omits junk support-team name phrases', () => {
  const result = extractReferralContactHeuristic({
    fromEmail: 'dconnolly@ala.org',
    leadEmail: 'dconnolly@ala.org',
    bodyText:
      'Please contact ALA JobLIST customer support team at clientserv@yourmembership.com for help.',
  });

  assert.equal(result.fields.email, 'clientserv@yourmembership.com');
  assert.equal(result.fields.name, undefined);
});

test('extractReferralContactHeuristic uses fromName on header mismatch without body referral', () => {
  const result = extractReferralContactHeuristic({
    fromEmail: 'new-contact@example.com',
    fromName: 'New Contact',
    leadEmail: 'old@example.com',
    bodyText: 'I received your message and will follow up soon.',
  });

  assert.equal(result.fields.email, 'new-contact@example.com');
  assert.equal(result.fields.name, 'New Contact');
  assert.equal(result.fields.firstName, 'New');
  assert.equal(result.fields.lastName, 'Contact');
});

test('isHighConfidencePersonName rejects trailing parenthesis fragments', () => {
  assert.equal(isHighConfidencePersonName('Rebecca Price ('), false);
  assert.equal(isHighConfidencePersonName('Rebecca Price'), true);
});

test('extractReferralContactHeuristic extracts Tradepoint Atlantic departure redirect', () => {
  const bodyText =
    'Thank you for contacting Tradepoint Atlantic. Lina Malechkova is no longer employed here. Please direct any future correspondence to \u200EAlex Kimtis\u200E at \u200Eakimtis@tradepointatlantic.com\u200E.';
  const result = extractReferralContactHeuristic({
    fromEmail: 'LMalechkova@tradepointatlantic.com',
    fromName: 'Lina Malechkova',
    leadEmail: 'lmalechkova@tradepointatlantic.com',
    bodyText,
  });

  assert.equal(result.fields.email, 'akimtis@tradepointatlantic.com');
  assert.equal(result.fields.name, 'Alex Kimtis');
  assert.equal(result.fields.firstName, 'Alex');
  assert.equal(result.fields.lastName, 'Kimtis');
});

test('buildSuggestedReferralFromExtraction writes sparse referral metadata', () => {
  const extraction = extractReferralContactHeuristic({
    fromEmail: 'brad.guimont@burryfoods.com',
    leadEmail: 'kelly.brennan@burryfoods.co',
    bodyText:
      'Brad Guimont is no longer with Burry. Please direct any questions to Kelly Brennan at kelly.brennan@burryfoods.com.',
  });

  const suggested = buildSuggestedReferralFromExtraction(extraction, 'auto_reply_forward');
  assert.equal(suggested.email, 'kelly.brennan@burryfoods.com');
  assert.equal(suggested.firstName, 'Kelly');
  assert.equal(suggested.lastName, 'Brennan');
  assert.equal(suggested.reason, 'auto_reply_forward');
  assert.ok(Array.isArray(suggested.filledFields));
});

test('mapTitleToCustomFields maps to matching custom key only', () => {
  assert.deepEqual(mapTitleToCustomFields('VP Sales', ['Job Title', 'Industry']), {
    'Job Title': 'VP Sales',
  });
  assert.equal(mapTitleToCustomFields('VP Sales', ['Industry']), undefined);
});

test('referralHasHighConfidenceName respects confidence and legacy fields', () => {
  assert.equal(
    referralHasHighConfidenceName({
      firstName: 'Kelly',
      confidence: { firstName: 'high' },
    }),
    true,
  );
  assert.equal(
    referralHasHighConfidenceName({
      name: 'Kelly Brennan',
      confidence: { name: 'low' },
    }),
    false,
  );
  assert.equal(referralHasHighConfidenceName({ name: 'Kelly Brennan' }), true);
});
