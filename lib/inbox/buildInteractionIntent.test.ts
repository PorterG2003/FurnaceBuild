import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInteractionIntent, detectSuggestedReplyUsage, inferSmartHandlingActionForCategory } from './buildInteractionIntent';
import { resolveSuggestionVersion } from './smartHandlingVersion';

test('inferSmartHandlingActionForCategory maps supported categories', () => {
  assert.equal(inferSmartHandlingActionForCategory('Interested'), 'mark_interested');
  assert.equal(inferSmartHandlingActionForCategory('Neutral'), 'mark_neutral');
  assert.equal(inferSmartHandlingActionForCategory('Not Interested'), 'mark_not_interested');
  assert.equal(inferSmartHandlingActionForCategory('Auto Reply'), 'mark_ooo_month');
  assert.equal(inferSmartHandlingActionForCategory('Other'), null);
});

test('detectSuggestedReplyUsage matches exact or prefixed composed body', () => {
  assert.equal(detectSuggestedReplyUsage('Hello there', 'hello there'), true);
  assert.equal(detectSuggestedReplyUsage('Hello there', ' Hello there\n\nThanks again '), true);
  assert.equal(detectSuggestedReplyUsage('Hello there', 'Different body'), false);
  assert.equal(detectSuggestedReplyUsage(null, 'Different body'), null);
});

test('buildInteractionIntent records primary matches and version passthrough', () => {
  const intent = buildInteractionIntent({
    metadata: {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category: 'Interested',
      primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
      suggested_reply: 'Thanks for the reply.',
    },
    actionId: 'mark_interested_reply',
    composedBody: 'Thanks for the reply.\n\nHappy to help.',
  });

  assert.deepEqual(intent, {
    action_id: 'mark_interested_reply',
    suggested_primary: 'mark_interested_reply',
    suggested_category: 'Interested',
    matched_suggestion: true,
    used_suggested_reply: true,
    suggestion_version: resolveSuggestionVersion('manual'),
  });
});

test('buildInteractionIntent records category picker overrides as mismatches', () => {
  const intent = buildInteractionIntent({
    metadata: {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category: 'Interested',
      primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
    },
    categorySelection: 'Not Interested',
  });

  assert.deepEqual(intent, {
    action_id: 'mark_not_interested',
    suggested_primary: 'mark_interested_reply',
    suggested_category: 'Interested',
    matched_suggestion: false,
    used_suggested_reply: null,
    suggestion_version: resolveSuggestionVersion('manual'),
  });
});

test('buildInteractionIntent returns null when there is no smart handling metadata or action', () => {
  assert.equal(buildInteractionIntent({}), null);
});
