import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOooSmartHandlingOptions, buildNeutralSmartHandlingOptions, buildNotInterestedSmartHandlingOptions, getSmartHandlingReplySeed, parseSmartHandlingMetadata } from './smartHandling';
import { isNotInterestedOptOutRequest } from './notInterestedOptOutDetection';
import { shouldAutoCloseConversationForAction, getSmartHandlingActionSuccessMessage, SMART_HANDLING_DISMISS_SUCCESS_MESSAGE } from './smartHandlingActions';

test('parseSmartHandlingMetadata reads sparse referral contact fields', () => {
  const result = parseSmartHandlingMetadata({
    mode: 'manual',
    suggested_referral: {
      email: 'kborthwick@passagebio.com',
      firstName: 'Kathleen',
      lastName: 'Borthwick',
      confidence: { email: 'high', firstName: 'high', lastName: 'high' },
      filledFields: ['email', 'firstName', 'lastName'],
      reason: 'auto_reply_forward',
    },
  });

  assert.equal(result?.suggested_referral?.email, 'kborthwick@passagebio.com');
  assert.equal(result?.suggested_referral?.firstName, 'Kathleen');
  assert.equal(result?.suggested_referral?.lastName, 'Borthwick');
  assert.deepEqual(result?.suggested_referral?.filledFields, ['email', 'firstName', 'lastName']);
});

test('parseSmartHandlingMetadata normalizes valid action payloads', () => {
  const result = parseSmartHandlingMetadata({
    mode: 'manual',
    category: 'Interested',
    primary_message: 'This looks interested.',
    primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
    alternatives: [{ action: 'mark_interested', label: 'Interested only' }],
    follow_ups: [{ action: 'reply_only', label: 'Reply only' }],
    return_date: null,
    suggested_reply: 'Happy to share more details.',
    suggested_referral: {
      email: 'referral@example.com',
      name: 'Referral Person',
      reason: 'manual_referral',
    },
    header_mismatch: true,
  });

  assert.deepEqual(result, {
    mode: 'manual',
    category: 'Interested',
    primary_message: 'This looks interested.',
    primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
    alternatives: [{ action: 'mark_interested', label: 'Interested only' }],
    follow_ups: [{ action: 'reply_only', label: 'Reply only' }],
    return_date: null,
    suggested_reply: 'Happy to share more details.',
    suggested_referral: {
      email: 'referral@example.com',
      name: 'Referral Person',
      reason: 'manual_referral',
    },
    header_mismatch: true,
  });
});

test('parseSmartHandlingMetadata returns null for non-object payloads', () => {
  assert.equal(parseSmartHandlingMetadata('bad-payload' as never), null);
  assert.equal(parseSmartHandlingMetadata(null), null);
});

test('buildOooSmartHandlingOptions uses dated primary with instant and custom alternatives', () => {
  const result = buildOooSmartHandlingOptions('2026-07-01');
  assert.equal(result.return_date, '2026-07-01');
  assert.equal(result.primary.action, 'mark_ooo_dated');
  assert.deepEqual(
    result.alternatives.map((option) => option.action),
    ['mark_ooo_instant', 'mark_ooo_custom'],
  );
});

test('buildOooSmartHandlingOptions uses month primary with instant and custom alternatives when no date', () => {
  const result = buildOooSmartHandlingOptions(null);
  assert.equal(result.return_date, null);
  assert.equal(result.primary.action, 'mark_ooo_month');
  assert.deepEqual(
    result.alternatives.map((option) => option.action),
    ['mark_ooo_instant', 'mark_ooo_custom'],
  );
});

test('buildNotInterestedSmartHandlingOptions uses block primary for opt-out language', () => {
  const result = buildNotInterestedSmartHandlingOptions({
    bodyText: 'Please unsubscribe and remove me from your list.',
  });
  assert.equal(result.primary.action, 'mark_not_interested_block');
  assert.deepEqual(
    result.alternatives.map((option) => option.action),
    ['mark_not_interested'],
  );
});

test('buildNotInterestedSmartHandlingOptions uses soft primary without opt-out language', () => {
  const result = buildNotInterestedSmartHandlingOptions({
    bodyText: 'Not a fit for us right now, thanks.',
  });
  assert.equal(result.primary.action, 'mark_not_interested');
  assert.deepEqual(
    result.alternatives.map((option) => option.action),
    ['mark_not_interested_block'],
  );
});

test('isNotInterestedOptOutRequest detects common removal phrases', () => {
  assert.equal(isNotInterestedOptOutRequest({ bodyText: 'Please stop emailing me.' }), true);
  assert.equal(isNotInterestedOptOutRequest({ bodyText: 'Not interested, wrong person.' }), false);
});

test('buildNeutralSmartHandlingOptions exposes interested reply and not interested alternatives', () => {
  const result = buildNeutralSmartHandlingOptions();
  assert.equal(result.primary.action, 'mark_neutral');
  assert.deepEqual(
    result.alternatives.map((option) => option.action),
    ['mark_interested_reply', 'mark_not_interested'],
  );
});

test('getSmartHandlingReplySeed uses interested copy when neutral is reclassified via interested reply', () => {
  assert.equal(
    getSmartHandlingReplySeed(
      {
        category: 'Neutral',
        suggested_reply: 'Thanks for the reply. Happy to circle back whenever the timing is better for you.',
      },
      'mark_interested_reply',
    ),
    'Thanks for the reply. Happy to share more details and find a time that works for you.',
  );
});

test('shouldAutoCloseConversationForAction matches disposition rules', () => {
  assert.equal(shouldAutoCloseConversationForAction('mark_not_interested'), true);
  assert.equal(shouldAutoCloseConversationForAction('mark_ooo_dated'), true);
  assert.equal(shouldAutoCloseConversationForAction('mark_ooo_custom'), false);
  assert.equal(shouldAutoCloseConversationForAction('block_sender'), true);
  assert.equal(shouldAutoCloseConversationForAction('mark_interested'), false);
  assert.equal(shouldAutoCloseConversationForAction('reply_only'), false);
});

test('getSmartHandlingActionSuccessMessage returns user-facing feedback copy', () => {
  assert.equal(
    getSmartHandlingActionSuccessMessage({ action: 'mark_interested_reply', label: 'Interested + reply' }),
    'Marked as Interested — reply ready',
  );
  assert.equal(
    getSmartHandlingActionSuccessMessage({ action: 'mark_not_interested_block', label: 'Not interested + block' }),
    'Marked as Not Interested and sender blocked',
  );
  assert.equal(
    getSmartHandlingActionSuccessMessage({ action: 'reply_only', label: 'Reply only' }),
    'Reply composer opened',
  );
  assert.equal(
    getSmartHandlingActionSuccessMessage({ action: 'mark_ooo_custom', label: 'Choose return date' }),
    'Opening out of office',
  );
  assert.equal(SMART_HANDLING_DISMISS_SUCCESS_MESSAGE, 'Suggestion dismissed');
});
