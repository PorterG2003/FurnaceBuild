import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_STATE,
  getCurrentStep,
  getProgress,
  reduce,
  type EngineState,
} from './engine';
import type { OnboardingFlow } from './types';

const flow: OnboardingFlow = {
  id: 'welcome',
  version: 1,
  steps: [
    { kind: 'announcement', render: () => null },
    {
      kind: 'spotlight',
      targetId: 'navItems',
      title: 'a',
      body: 'b',
      advance: 'manual',
    },
    {
      kind: 'spotlight',
      targetId: 'accountTeam',
      title: 'c',
      body: 'd',
      advance: 'onTargetPress',
    },
  ],
};

const emptyFlow: OnboardingFlow = { id: 'welcome', version: 1, steps: [] };

function start(): EngineState {
  return reduce(INITIAL_STATE, { type: 'START', flow });
}

test('START activates the flow at step 0', () => {
  const state = start();
  assert.equal(state.status, 'active');
  assert.equal(state.stepIndex, 0);
  assert.equal(getCurrentStep(state)?.kind, 'announcement');
});

test('START on an empty flow completes immediately', () => {
  const state = reduce(INITIAL_STATE, { type: 'START', flow: emptyFlow });
  assert.equal(state.status, 'completed');
  assert.equal(getCurrentStep(state), null);
});

test('NEXT advances through steps and completes at the end', () => {
  let state = start();
  state = reduce(state, { type: 'NEXT' });
  assert.equal(state.stepIndex, 1);
  state = reduce(state, { type: 'NEXT' });
  assert.equal(state.stepIndex, 2);
  state = reduce(state, { type: 'NEXT' });
  assert.equal(state.status, 'completed');
});

test('BACK is clamped at the first step', () => {
  let state = start();
  state = reduce(state, { type: 'BACK' });
  assert.equal(state.stepIndex, 0);
  state = reduce(state, { type: 'NEXT' });
  state = reduce(state, { type: 'BACK' });
  assert.equal(state.stepIndex, 0);
});

test('TARGET_PRESS advances only onTargetPress steps', () => {
  let state = start();
  // Step 0 is an announcement: target press is a no-op.
  state = reduce(state, { type: 'TARGET_PRESS' });
  assert.equal(state.stepIndex, 0);
  // Step 1 is a manual spotlight: target press is a no-op.
  state = reduce(state, { type: 'NEXT' });
  state = reduce(state, { type: 'TARGET_PRESS' });
  assert.equal(state.stepIndex, 1);
  // Step 2 is an onTargetPress spotlight: target press advances (-> completes).
  state = reduce(state, { type: 'NEXT' });
  assert.equal(state.stepIndex, 2);
  state = reduce(state, { type: 'TARGET_PRESS' });
  assert.equal(state.status, 'completed');
});

test('SKIP_STEP advances regardless of advance mode', () => {
  let state = start();
  state = reduce(state, { type: 'NEXT' });
  state = reduce(state, { type: 'NEXT' });
  assert.equal(state.stepIndex, 2);
  state = reduce(state, { type: 'SKIP_STEP' });
  assert.equal(state.status, 'completed');
});

test('DISMISS ends the flow as dismissed', () => {
  const state = reduce(start(), { type: 'DISMISS' });
  assert.equal(state.status, 'dismissed');
  assert.equal(getCurrentStep(state), null);
});

test('ABORT ends the flow as aborted (distinct from dismissed)', () => {
  const state = reduce(start(), { type: 'ABORT' });
  assert.equal(state.status, 'aborted');
  assert.equal(getCurrentStep(state), null);
});

test('ABORT is inert once the flow is finished', () => {
  const completed = reduce(start(), { type: 'FINISH' });
  assert.deepEqual(reduce(completed, { type: 'ABORT' }), completed);
});

test('actions are inert once the flow is finished', () => {
  const completed = reduce(start(), { type: 'FINISH' });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(reduce(completed, { type: 'NEXT' }), completed);
  assert.deepEqual(reduce(completed, { type: 'BACK' }), completed);
  assert.deepEqual(reduce(completed, { type: 'DISMISS' }), completed);
});

test('getProgress reports index and total while active', () => {
  const state = start();
  assert.deepEqual(getProgress(state), { index: 0, total: 3 });
  assert.equal(getProgress(INITIAL_STATE), null);
});

test('RESET returns to the idle initial state', () => {
  const completed = reduce(start(), { type: 'FINISH' });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(reduce(completed, { type: 'RESET' }), INITIAL_STATE);
});
