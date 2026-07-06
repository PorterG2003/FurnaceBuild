import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpotlightSurface, type OnboardingHostId } from './onboardingHosts';
import { TARGETS } from './types';
import type { OnboardingStep, TargetId } from './types';

function spotlight(targetId: TargetId, hostId?: OnboardingHostId): OnboardingStep {
  return { kind: 'spotlight', targetId, title: 't', body: 'b', hostId };
}

test('resolveSpotlightSurface returns null with no step', () => {
  assert.equal(resolveSpotlightSurface(null, false), null);
  assert.equal(resolveSpotlightSurface(null, true), null);
});

test('resolveSpotlightSurface returns host when the step declares a hostId, even when blocking present', () => {
  const step = spotlight(TARGETS.inboxActionClose, 'inboxMessageActions');
  assert.equal(resolveSpotlightSurface(step, false), 'host');
  assert.equal(resolveSpotlightSurface(step, true), 'host');
});

test('resolveSpotlightSurface returns global for the same target id when the step has no hostId', () => {
  // Same TargetId as the host-routed step above — routing must come from the
  // step, never be inferred from the target alone.
  assert.equal(resolveSpotlightSurface(spotlight(TARGETS.inboxActionClose), false), 'global');
});

test('resolveSpotlightSurface returns global for screen targets when nothing blocks', () => {
  assert.equal(resolveSpotlightSurface(spotlight(TARGETS.inboxMobileActions), false), 'global');
});

test('resolveSpotlightSurface returns null for screen targets when an unrelated modal blocks', () => {
  assert.equal(resolveSpotlightSurface(spotlight(TARGETS.inboxMobileActions), true), null);
});

test('resolveSpotlightSurface ignores non-spotlight steps', () => {
  const announcement = { kind: 'announcement', render: () => null } as unknown as OnboardingStep;
  assert.equal(resolveSpotlightSurface(announcement, false), null);
});
