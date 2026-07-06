import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetSurface, targetKey } from './targetRegistry';
import { TARGETS } from './types';
import type { OnboardingStep } from './types';

test('targetKey scopes the same id differently per surface', () => {
  const globalKey = targetKey(TARGETS.inboxActionClose, 'global');
  const hostKey = targetKey(TARGETS.inboxActionClose, 'inboxMessageActions');
  assert.notEqual(globalKey, hostKey);
});

const hostStep: OnboardingStep = {
  kind: 'spotlight',
  targetId: TARGETS.inboxActionClose,
  hostId: 'inboxMessageActions',
  title: 't',
  body: 'b',
};

const globalStep: OnboardingStep = {
  kind: 'spotlight',
  targetId: TARGETS.inboxLeadDetail,
  title: 't',
  body: 'b',
};

test('resolveTargetSurface prefers an explicit surface over the active step', () => {
  assert.equal(resolveTargetSurface('global', hostStep), 'global');
});

test('resolveTargetSurface falls back to the active spotlight step hostId', () => {
  assert.equal(resolveTargetSurface(undefined, hostStep), 'inboxMessageActions');
});

test('resolveTargetSurface defaults to global with no explicit surface, no step, or no hostId', () => {
  assert.equal(resolveTargetSurface(undefined, null), 'global');
  assert.equal(resolveTargetSurface(undefined, globalStep), 'global');
});

test('resolveTargetSurface ignores hostId on non-spotlight steps', () => {
  const announcement = { kind: 'announcement', render: () => null } as unknown as OnboardingStep;
  assert.equal(resolveTargetSurface(undefined, announcement), 'global');
});
