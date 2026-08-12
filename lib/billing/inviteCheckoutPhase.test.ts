import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canReplaceInviteCheckoutAttempt,
  mergeInviteCheckoutPhase,
  normalizeInviteCheckoutPhase,
  resolveInviteCheckoutAction,
} from './inviteCheckoutPhase';

test('normalizeInviteCheckoutPhase maps microdeposit verification', () => {
  const result = normalizeInviteCheckoutPhase({
    sessionStatus: 'complete',
    paymentStatus: 'unpaid',
    paymentIntentStatus: 'requires_action',
    nextActionType: 'verify_with_microdeposits',
    hostedVerificationUrl: 'https://payments.stripe.com/microdeposit/test',
    paymentRoute: 'ach',
  });
  assert.equal(result.phase, 'verification_required');
  assert.equal(result.hostedVerificationUrl, 'https://payments.stripe.com/microdeposit/test');
});

test('normalizeInviteCheckoutPhase maps processing and succeeded', () => {
  assert.equal(
    normalizeInviteCheckoutPhase({
      sessionStatus: 'complete',
      paymentStatus: 'unpaid',
      paymentIntentStatus: 'processing',
      nextActionType: null,
      paymentRoute: 'ach',
    }).phase,
    'processing',
  );
  assert.equal(
    normalizeInviteCheckoutPhase({
      sessionStatus: 'complete',
      paymentStatus: 'paid',
      paymentIntentStatus: 'succeeded',
      nextActionType: null,
      paymentRoute: 'card',
    }).phase,
    'succeeded',
  );
});

test('normalizeInviteCheckoutPhase maps expired and failed', () => {
  assert.equal(
    normalizeInviteCheckoutPhase({
      sessionStatus: 'expired',
      paymentStatus: 'unpaid',
      paymentIntentStatus: null,
      nextActionType: null,
    }).phase,
    'expired',
  );
  assert.equal(
    normalizeInviteCheckoutPhase({
      sessionStatus: 'complete',
      paymentStatus: 'unpaid',
      paymentIntentStatus: 'canceled',
      nextActionType: null,
    }).phase,
    'failed',
  );
});

test('resolveInviteCheckoutAction provisions on processing for current attempt', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'processing',
    invitationAlreadyProvisioned: false,
    isCurrentAttempt: true,
  });
  assert.equal(action.kind, 'provision');
  assert.equal(action.canReplaceCheckout, false);
});

test('resolveInviteCheckoutAction does not provision during verification', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'verification_required',
    invitationAlreadyProvisioned: false,
    isCurrentAttempt: true,
    hostedVerificationUrl: 'https://example.test/verify',
  });
  assert.equal(action.kind, 'persist_phase');
  assert.equal(action.phase, 'verification_required');
});

test('resolveInviteCheckoutAction marks payment_required after provisioned failure', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'failed',
    invitationAlreadyProvisioned: true,
    isCurrentAttempt: true,
    failureSummary: 'ACH returned',
  });
  assert.equal(action.kind, 'mark_payment_required');
});

test('resolveInviteCheckoutAction allows replacement before provision', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'failed',
    invitationAlreadyProvisioned: false,
    isCurrentAttempt: true,
  });
  assert.equal(action.kind, 'mark_failed');
  assert.equal(action.canReplaceCheckout, true);
  assert.equal(canReplaceInviteCheckoutAttempt('failed'), true);
});

test('resolveInviteCheckoutAction ignores stale attempts for provisioning', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'processing',
    invitationAlreadyProvisioned: false,
    isCurrentAttempt: false,
  });
  assert.equal(action.kind, 'persist_phase');
  assert.match(action.reason, /Stale checkout attempt/);
});

test('mergeInviteCheckoutPhase never regresses processing to verification', () => {
  assert.equal(mergeInviteCheckoutPhase('processing', 'verification_required'), 'processing');
  assert.equal(mergeInviteCheckoutPhase('succeeded', 'failed'), 'succeeded');
  assert.equal(mergeInviteCheckoutPhase('verification_required', 'processing'), 'processing');
});
