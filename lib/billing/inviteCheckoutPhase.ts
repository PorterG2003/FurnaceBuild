import type { PlatformPaymentRoute } from './paymentRoutes';

export type InviteCheckoutPhase =
  | 'awaiting_checkout'
  | 'open'
  | 'verification_required'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired';

export type InviteCheckoutActionKind =
  | 'noop'
  | 'persist_phase'
  | 'provision'
  | 'mark_failed'
  | 'mark_payment_required';

export type InviteCheckoutAction = {
  kind: InviteCheckoutActionKind;
  phase: InviteCheckoutPhase;
  reason: string;
  hostedVerificationUrl?: string | null;
  failureSummary?: string | null;
  canReplaceCheckout: boolean;
};

export type InviteCheckoutStripeSnapshot = {
  sessionStatus: string | null | undefined;
  paymentStatus: string | null | undefined;
  paymentIntentStatus: string | null | undefined;
  nextActionType: string | null | undefined;
  hostedVerificationUrl?: string | null | undefined;
  paymentRoute?: PlatformPaymentRoute | null;
};

const TERMINAL_PHASES = new Set<InviteCheckoutPhase>(['succeeded', 'failed', 'expired']);

export function isInviteCheckoutTerminalPhase(phase: InviteCheckoutPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function canReplaceInviteCheckoutAttempt(phase: InviteCheckoutPhase | null | undefined): boolean {
  return phase == null || phase === 'failed' || phase === 'expired';
}

export function normalizeInviteCheckoutPhase(
  snapshot: InviteCheckoutStripeSnapshot,
): {
  phase: InviteCheckoutPhase;
  hostedVerificationUrl: string | null;
  failureSummary: string | null;
} {
  const sessionStatus = snapshot.sessionStatus ?? null;
  const paymentStatus = snapshot.paymentStatus ?? null;
  const paymentIntentStatus = snapshot.paymentIntentStatus ?? null;
  const nextActionType = snapshot.nextActionType ?? null;
  const hostedVerificationUrl =
    typeof snapshot.hostedVerificationUrl === 'string' && snapshot.hostedVerificationUrl.length > 0
      ? snapshot.hostedVerificationUrl
      : null;

  if (sessionStatus === 'expired') {
    return {
      phase: 'expired',
      hostedVerificationUrl: null,
      failureSummary: 'Checkout session expired before payment completed.',
    };
  }

  if (
    paymentIntentStatus === 'canceled' ||
    paymentIntentStatus === 'payment_failed' ||
    (paymentStatus === 'unpaid' &&
      sessionStatus === 'complete' &&
      paymentIntentStatus === 'requires_payment_method')
  ) {
    return {
      phase: 'failed',
      hostedVerificationUrl: null,
      failureSummary: 'Bank payment failed or was canceled.',
    };
  }

  if (
    paymentIntentStatus === 'requires_action' &&
    nextActionType === 'verify_with_microdeposits'
  ) {
    return {
      phase: 'verification_required',
      hostedVerificationUrl,
      failureSummary: null,
    };
  }

  if (paymentStatus === 'paid' || paymentIntentStatus === 'succeeded') {
    return {
      phase: 'succeeded',
      hostedVerificationUrl: null,
      failureSummary: null,
    };
  }

  if (paymentIntentStatus === 'processing') {
    return {
      phase: 'processing',
      hostedVerificationUrl: null,
      failureSummary: null,
    };
  }

  if (sessionStatus === 'open') {
    return {
      phase: 'open',
      hostedVerificationUrl: null,
      failureSummary: null,
    };
  }

  if (sessionStatus === 'complete' && paymentStatus === 'unpaid') {
    // Async method finished Checkout but has not reached processing/succeeded yet.
    if (snapshot.paymentRoute === 'ach') {
      return {
        phase: hostedVerificationUrl ? 'verification_required' : 'open',
        hostedVerificationUrl,
        failureSummary: null,
      };
    }
  }

  return {
    phase: 'open',
    hostedVerificationUrl: null,
    failureSummary: null,
  };
}

export function resolveInviteCheckoutAction(input: {
  phase: InviteCheckoutPhase;
  invitationAlreadyProvisioned: boolean;
  isCurrentAttempt: boolean;
  hostedVerificationUrl?: string | null;
  failureSummary?: string | null;
}): InviteCheckoutAction {
  const {
    phase,
    invitationAlreadyProvisioned,
    isCurrentAttempt,
    hostedVerificationUrl = null,
    failureSummary = null,
  } = input;

  if (!isCurrentAttempt) {
    return {
      kind: 'persist_phase',
      phase,
      reason: 'Stale checkout attempt updated without affecting the current invitation.',
      hostedVerificationUrl,
      failureSummary,
      canReplaceCheckout: false,
    };
  }

  if (phase === 'verification_required') {
    return {
      kind: 'persist_phase',
      phase,
      reason: 'ACH microdeposit verification is required before provisioning.',
      hostedVerificationUrl,
      failureSummary: null,
      canReplaceCheckout: false,
    };
  }

  if (phase === 'open' || phase === 'awaiting_checkout') {
    return {
      kind: 'noop',
      phase,
      reason: 'Checkout has not reached a provisionable payment state.',
      canReplaceCheckout: false,
    };
  }

  if (phase === 'processing' || phase === 'succeeded') {
    if (invitationAlreadyProvisioned) {
      return {
        kind: 'persist_phase',
        phase: phase === 'succeeded' ? 'succeeded' : 'processing',
        reason: 'Workspace already provisioned; confirming payment phase.',
        canReplaceCheckout: false,
      };
    }
    return {
      kind: 'provision',
      phase,
      reason:
        phase === 'processing'
          ? 'ACH debit initiated after bank verification; provision workspace.'
          : 'Payment succeeded; provision workspace.',
      canReplaceCheckout: false,
    };
  }

  if (phase === 'failed' || phase === 'expired') {
    if (invitationAlreadyProvisioned) {
      return {
        kind: 'mark_payment_required',
        phase: 'failed',
        reason: 'Payment failed after workspace provisioning.',
        failureSummary: failureSummary ?? 'Payment failed after workspace activation.',
        canReplaceCheckout: false,
      };
    }
    return {
      kind: 'mark_failed',
      phase,
      reason: 'Payment failed before workspace provisioning.',
      failureSummary: failureSummary ?? 'Payment failed before workspace activation.',
      canReplaceCheckout: true,
    };
  }

  return {
    kind: 'noop',
    phase,
    reason: 'No checkout action required.',
    canReplaceCheckout: false,
  };
}

export function mergeInviteCheckoutPhase(
  currentPhase: InviteCheckoutPhase | null | undefined,
  nextPhase: InviteCheckoutPhase,
): InviteCheckoutPhase {
  if (!currentPhase) return nextPhase;
  if (currentPhase === nextPhase) return nextPhase;

  // Never regress a provisionable/settled state back to verification/open.
  const rank: Record<InviteCheckoutPhase, number> = {
    awaiting_checkout: 0,
    open: 1,
    verification_required: 2,
    processing: 3,
    succeeded: 4,
    failed: 5,
    expired: 5,
  };

  if (currentPhase === 'succeeded') return 'succeeded';
  if (currentPhase === 'processing' && (nextPhase === 'open' || nextPhase === 'verification_required')) {
    return 'processing';
  }
  if (rank[nextPhase] >= rank[currentPhase]) return nextPhase;
  return currentPhase;
}
