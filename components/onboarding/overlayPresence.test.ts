import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBlockingOverlayCount,
  isOnboardingHostMounted,
  pushBlockingOverlay,
  pushOnboardingHost,
} from './overlayPresence';

test('blocking overlay push/release adjusts the blocking count', () => {
  const before = getBlockingOverlayCount();
  const release = pushBlockingOverlay();
  assert.equal(getBlockingOverlayCount(), before + 1);
  release();
  assert.equal(getBlockingOverlayCount(), before);
});

test('onboarding host registration does not increment the blocking count', () => {
  const before = getBlockingOverlayCount();
  const release = pushOnboardingHost('inboxMessageActions');
  assert.equal(getBlockingOverlayCount(), before);
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), true);
  release();
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), false);
});

test('onboarding host mounting is reference counted', () => {
  const releaseA = pushOnboardingHost('inboxMessageActions');
  const releaseB = pushOnboardingHost('inboxMessageActions');
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), true);
  releaseA();
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), true);
  releaseB();
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), false);
  // Double release is a no-op.
  releaseB();
  assert.equal(isOnboardingHostMounted('inboxMessageActions'), false);
});
