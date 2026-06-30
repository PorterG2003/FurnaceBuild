import test from 'node:test';
import assert from 'node:assert/strict';
import { canRequestFlow, type RequestFlowConditions } from './triggerGuards';

const eligible: RequestFlowConditions = {
  enabled: true,
  stateLoaded: true,
  hasUser: true,
  flowExists: true,
  alreadySeen: false,
  flowActive: false,
  flowPending: false,
  blockingOverlayPresent: false,
};

test('allows a flow when every condition is satisfied', () => {
  assert.equal(canRequestFlow(eligible), true);
});

test('single-flight: blocks when another flow is active', () => {
  assert.equal(canRequestFlow({ ...eligible, flowActive: true }), false);
});

test('single-flight: blocks when another flow is pending', () => {
  assert.equal(canRequestFlow({ ...eligible, flowPending: true }), false);
});

test('blocks already-seen flows', () => {
  assert.equal(canRequestFlow({ ...eligible, alreadySeen: true }), false);
});

test('blocks when disabled, not loaded, or signed out', () => {
  assert.equal(canRequestFlow({ ...eligible, enabled: false }), false);
  assert.equal(canRequestFlow({ ...eligible, stateLoaded: false }), false);
  assert.equal(canRequestFlow({ ...eligible, hasUser: false }), false);
});

test('blocks unknown flows and while a blocking overlay is present', () => {
  assert.equal(canRequestFlow({ ...eligible, flowExists: false }), false);
  assert.equal(canRequestFlow({ ...eligible, blockingOverlayPresent: true }), false);
});
