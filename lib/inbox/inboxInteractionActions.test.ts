import assert from 'node:assert/strict';
import test from 'node:test';
import { mapThreadActionSourceToInteractionSource, mapThreadActionToInteractionAction, INSTRUMENTED_THREAD_ACTIONS } from './inboxInteractionActions';
import { THREAD_ACTION_DEFINITIONS } from './threadActionDefinitions';

test('mapThreadActionSourceToInteractionSource converts UI sources', () => {
  assert.equal(mapThreadActionSourceToInteractionSource('smart_handling'), 'smart_handling_bar');
  assert.equal(mapThreadActionSourceToInteractionSource('message_menu'), 'message_menu');
});

test('mapThreadActionToInteractionAction maps each instrumented thread action', () => {
  for (const actionId of INSTRUMENTED_THREAD_ACTIONS) {
    const mapped = mapThreadActionToInteractionAction(actionId);
    assert.match(mapped, /^(thread|lead)\./);
  }
});

test('instrumented thread actions stay aligned with thread action definitions', () => {
  const supportedActions = Object.keys(THREAD_ACTION_DEFINITIONS).filter((actionId) => actionId !== 'dismiss');
  assert.deepEqual([...INSTRUMENTED_THREAD_ACTIONS].sort(), supportedActions.sort());
});
