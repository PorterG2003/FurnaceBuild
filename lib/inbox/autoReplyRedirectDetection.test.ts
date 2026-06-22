import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectAutoReplyRedirectSignals,
  extractEmailCandidates,
  extractReferralNameNearEmail,
} from './autoReplyRedirectDetection';

test('extractEmailCandidates normalizes and deduplicates addresses', () => {
  assert.deepEqual(
    extractEmailCandidates('Contact KBorthwick@PassageBio.com or kborthwick@passagebio.com.'),
    ['kborthwick@passagebio.com'],
  );
});

test('extractEmailCandidates strips surrounding punctuation', () => {
  assert.deepEqual(
    extractEmailCandidates('Please email .paul@kitchenarmor.com, then follow up later.'),
    ['paul@kitchenarmor.com'],
  );
});

test('detectAutoReplyRedirectSignals flags Passage Bio departure redirect', () => {
  const result = detectAutoReplyRedirectSignals({
    fromEmail: 'rmastropietro_c@passagebio.com',
    leadEmail: 'rmastropietro@passagebio.com',
    bodyText:
      'Rich Mastropietro is no longer with Passage Bio. Please contact Kathleen Borthwick at kborthwick@passagebio.com with any inquiries.',
  });

  assert.equal(result.headerMismatch, true);
  assert.equal(result.referralEmail, 'kborthwick@passagebio.com');
  assert.equal(result.referralName, 'Kathleen Borthwick');
  assert.equal(result.shouldReplaceLead, true);
});

test('detectAutoReplyRedirectSignals flags Burry departure redirect', () => {
  const result = detectAutoReplyRedirectSignals({
    fromEmail: 'brad.guimont@burryfoods.com',
    leadEmail: 'kelly.brennan@burryfoods.co',
    bodyText:
      'Thank you for your email. Brad Guimont is no longer with Burry. Please direct any questions to Kelly Brennan at kelly.brennan@burryfoods.com.',
  });

  assert.equal(result.headerMismatch, true);
  assert.equal(result.referralEmail, 'kelly.brennan@burryfoods.com');
  assert.equal(result.referralName, 'Kelly Brennan');
  assert.equal(result.shouldReplaceLead, true);
});

test('detectAutoReplyRedirectSignals ignores true OOO from the same sender', () => {
  const result = detectAutoReplyRedirectSignals({
    fromEmail: 'lead@co.com',
    leadEmail: 'lead@co.com',
    bodyText: 'I am out until Friday and will reply when I am back.',
  });

  assert.equal(result.headerMismatch, false);
  assert.equal(result.referralEmail, null);
  assert.equal(result.referralName, null);
  assert.equal(result.shouldReplaceLead, false);
});

test('extractReferralNameNearEmail returns null when no name precedes the referral email', () => {
  assert.equal(
    extractReferralNameNearEmail(
      'Please reach out to kborthwick@passagebio.com for help.',
      'kborthwick@passagebio.com',
    ),
    null,
  );
});

test('extractReferralNameNearEmail strips trailing parenthesis from captured names', () => {
  const body =
    'Please contact Rebecca Price (former manager) at rebecca@example.com for help.';
  assert.equal(extractReferralNameNearEmail(body, 'rebecca@example.com'), 'Rebecca Price');
});

test('extractReferralNameNearEmail handles direct any future correspondence phrasing', () => {
  const body =
    'Lina Malechkova is no longer employed here. Please direct any future correspondence to Alex Kimtis at akimtis@tradepointatlantic.com.';
  assert.equal(extractReferralNameNearEmail(body, 'akimtis@tradepointatlantic.com'), 'Alex Kimtis');
});

test('extractReferralNameNearEmail strips unicode direction marks around name and email', () => {
  const body =
    'Please direct any future correspondence to \u200EAlex Kimtis\u200E at \u200Eakimtis@tradepointatlantic.com\u200E.';
  assert.equal(extractReferralNameNearEmail(body, 'akimtis@tradepointatlantic.com'), 'Alex Kimtis');
});

test('detectAutoReplyRedirectSignals flags Tradepoint Atlantic departure redirect', () => {
  const result = detectAutoReplyRedirectSignals({
    fromEmail: 'LMalechkova@tradepointatlantic.com',
    leadEmail: 'lmalechkova@tradepointatlantic.com',
    bodyText:
      'Thank you for contacting Tradepoint Atlantic. Lina Malechkova is no longer employed here. Please direct any future correspondence to Alex Kimtis at akimtis@tradepointatlantic.com.',
  });

  assert.equal(result.headerMismatch, false);
  assert.equal(result.referralEmail, 'akimtis@tradepointatlantic.com');
  assert.equal(result.referralName, 'Alex Kimtis');
  assert.equal(result.shouldReplaceLead, true);
});
