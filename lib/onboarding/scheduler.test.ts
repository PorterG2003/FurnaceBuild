import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartFlow, pickNextFlow, type StartFlowConditions } from './scheduler';
import type { FlowId, OnboardingFlowDef } from './types';

const eligible: StartFlowConditions = {
  enabled: true,
  stateLoaded: true,
  hasUser: true,
  flowExists: true,
  alreadySeen: false,
  engineIdle: true,
  blockingOverlayPresent: false,
};

const flows: OnboardingFlowDef[] = [
  { id: 'welcome', version: 1, autoStart: true, steps: [] },
  { id: 'inbox', version: 1, steps: [] },
  { id: 'inbox-mobile', version: 1, steps: [] },
  { id: 'leads', version: 1, steps: [] },
  { id: 'account', version: 1, steps: [] },
];

test('canStartFlow allows when every condition is satisfied', () => {
  assert.equal(canStartFlow(eligible), true);
});

test('canStartFlow blocks when engine is not idle', () => {
  assert.equal(canStartFlow({ ...eligible, engineIdle: false }), false);
});

test('canStartFlow blocks already-seen flows', () => {
  assert.equal(canStartFlow({ ...eligible, alreadySeen: true }), false);
});

test('canStartFlow blocks when disabled, not loaded, or signed out', () => {
  assert.equal(canStartFlow({ ...eligible, enabled: false }), false);
  assert.equal(canStartFlow({ ...eligible, stateLoaded: false }), false);
  assert.equal(canStartFlow({ ...eligible, hasUser: false }), false);
});

test('canStartFlow blocks unknown flows and while a blocking overlay is present', () => {
  assert.equal(canStartFlow({ ...eligible, flowExists: false }), false);
  assert.equal(canStartFlow({ ...eligible, blockingOverlayPresent: true }), false);
});

test('pickNextFlow prefers welcome via autoStart when unseen', () => {
  const id = pickNextFlow({
    flows,
    seen: new Set(),
    readyRegistrations: new Set<FlowId>(),
  });
  assert.equal(id, 'welcome');
});

test('pickNextFlow skips seen flows in registry order', () => {
  const id = pickNextFlow({
    flows,
    seen: new Set(['welcome']),
    readyRegistrations: new Set<FlowId>(['inbox']),
  });
  assert.equal(id, 'inbox');
});

test('pickNextFlow returns the first ready flow in registry order', () => {
  const id = pickNextFlow({
    flows,
    seen: new Set(['welcome', 'inbox']),
    readyRegistrations: new Set<FlowId>(['leads', 'account']),
  });
  assert.equal(id, 'leads');
});

test('pickNextFlow ignores unregistered non-autoStart flows', () => {
  const id = pickNextFlow({
    flows,
    seen: new Set(['welcome']),
    readyRegistrations: new Set<FlowId>(),
  });
  assert.equal(id, null);
});
