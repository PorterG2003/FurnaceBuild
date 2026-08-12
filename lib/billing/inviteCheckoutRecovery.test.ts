import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canReplaceInviteCheckoutAttempt,
  mergeInviteCheckoutPhase,
  normalizeInviteCheckoutPhase,
  resolveInviteCheckoutAction,
} from './inviteCheckoutPhase';
import { getInviteCheckoutRecoveryCopy } from './inviteCheckoutRecoveryCopy';
import { buildInviteCheckoutReconciliationPlan } from './reconcileInviteCheckout';

test('wendt-style ACH microdeposit remains verification_required until processing', () => {
  const verified = normalizeInviteCheckoutPhase({
    sessionStatus: 'complete',
    paymentStatus: 'unpaid',
    paymentIntentStatus: 'requires_action',
    nextActionType: 'verify_with_microdeposits',
    hostedVerificationUrl: 'https://payments.stripe.com/microdeposit/wendt',
    paymentRoute: 'ach',
  });
  assert.equal(verified.phase, 'verification_required');
  assert.equal(
    resolveInviteCheckoutAction({
      phase: verified.phase,
      invitationAlreadyProvisioned: false,
      isCurrentAttempt: true,
      hostedVerificationUrl: verified.hostedVerificationUrl,
    }).kind,
    'persist_phase',
  );

  const processing = normalizeInviteCheckoutPhase({
    sessionStatus: 'complete',
    paymentStatus: 'unpaid',
    paymentIntentStatus: 'processing',
    nextActionType: null,
    paymentRoute: 'ach',
  });
  assert.equal(processing.phase, 'processing');
  assert.equal(
    resolveInviteCheckoutAction({
      phase: processing.phase,
      invitationAlreadyProvisioned: false,
      isCurrentAttempt: true,
    }).kind,
    'provision',
  );
});

test('card paid provisions immediately', () => {
  const paid = normalizeInviteCheckoutPhase({
    sessionStatus: 'complete',
    paymentStatus: 'paid',
    paymentIntentStatus: 'succeeded',
    nextActionType: null,
    paymentRoute: 'card',
  });
  assert.equal(paid.phase, 'succeeded');
  assert.equal(
    resolveInviteCheckoutAction({
      phase: paid.phase,
      invitationAlreadyProvisioned: false,
      isCurrentAttempt: true,
    }).kind,
    'provision',
  );
});

test('failed attempt before provision can be replaced', () => {
  assert.equal(canReplaceInviteCheckoutAttempt('failed'), true);
  assert.equal(canReplaceInviteCheckoutAttempt('verification_required'), false);
  assert.equal(canReplaceInviteCheckoutAttempt('processing'), false);
});

test('stale superseded attempt never provisions or blocks current attempt', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'processing',
    invitationAlreadyProvisioned: false,
    isCurrentAttempt: false,
  });
  assert.equal(action.kind, 'persist_phase');
  assert.equal(action.canReplaceCheckout, false);
});

test('out-of-order verification event cannot regress processing', () => {
  assert.equal(mergeInviteCheckoutPhase('processing', 'verification_required'), 'processing');
  assert.equal(mergeInviteCheckoutPhase('succeeded', 'failed'), 'succeeded');
  assert.equal(mergeInviteCheckoutPhase('verification_required', 'processing'), 'processing');
});

test('failure after provisioning marks payment_required instead of replacement', () => {
  const action = resolveInviteCheckoutAction({
    phase: 'failed',
    invitationAlreadyProvisioned: true,
    isCurrentAttempt: true,
    failureSummary: 'ACH debit returned',
  });
  assert.equal(action.kind, 'mark_payment_required');
  assert.equal(action.canReplaceCheckout, false);
});

test('existing pending attempt becoming processing plans provisioning', () => {
  const plan = buildInviteCheckoutReconciliationPlan({
    invitationStatus: 'pending_payment',
    invitationAccountId: null,
    currentAttemptId: 'attempt-1',
    invitationCheckoutSessionId: 'cs_test_wendt',
    attempt: {
      id: 'attempt-1',
      phase: 'verification_required',
      stripe_checkout_session_id: 'cs_test_wendt',
    },
    checkoutSessionId: 'cs_test_wendt',
    sessionStatus: 'complete',
    paymentStatus: 'unpaid',
    paymentIntentStatus: 'processing',
    nextActionType: null,
    hostedVerificationUrl: null,
    paymentRoute: 'ach',
  });
  assert.equal(plan.stripePhase, 'processing');
  assert.equal(plan.proposedAction.kind, 'provision');
  assert.equal(plan.needsReplacementCheckout, false);
  assert.equal(plan.alreadyProvisioned, false);
});

test('recovery copy exposes verify/retry/replace actions by phase', () => {
  assert.equal(getInviteCheckoutRecoveryCopy('verification_required').showVerifyBank, true);
  assert.equal(getInviteCheckoutRecoveryCopy('processing').showRetryActivation, true);
  assert.equal(getInviteCheckoutRecoveryCopy('failed').showReplaceCheckout, true);
  assert.equal(getInviteCheckoutRecoveryCopy('expired').showReplaceCheckout, true);
  assert.equal(getInviteCheckoutRecoveryCopy('succeeded').showSpinner, true);
});
