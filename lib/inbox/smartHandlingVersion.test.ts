import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORIZER_PROMPT_VERSION,
  MANUAL_SMART_HANDLING_VERSION,
  resolveSuggestionVersion,
} from './smartHandlingVersion';

test('resolveSuggestionVersion returns the manual version', () => {
  assert.equal(resolveSuggestionVersion('manual'), MANUAL_SMART_HANDLING_VERSION);
});

test('resolveSuggestionVersion returns the AI prompt version', () => {
  assert.equal(resolveSuggestionVersion('ai'), CATEGORIZER_PROMPT_VERSION);
});
