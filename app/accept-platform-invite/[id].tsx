import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlatformInviteExperience } from '@/components/platform/invite/PlatformInviteExperience';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { useSmoothLoading } from '@/components/ui/feedback/useSmoothLoading';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import {
  acceptPlatformInvitation,
  getPlatformInvitationInfo,
  preparePlatformInvitationCheckout,
  type PlatformInvitationInfo,
} from '@/lib/supabase/services/platform';
import { getAccountMembershipsForUser } from '@/lib/supabase/services/accounts';
import {
  createPlatformCheckoutSession,
  ensurePlatformInviteAuthUser,
  getPlatformCheckoutQuote,
} from '@/lib/services/platform';
import { waitForInviteActivation } from '@/lib/platform/invite/activation';
import {
  isPlatformInviteCompletedStatus,
  isPlatformInviteUnavailableStatus,
} from '@/lib/platform/invite/accessState';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type {
  PlatformInviteCheckoutInput,
  PlatformContractViewData,
} from '@/lib/platform/contract/types';
import { normalizeAgreementType } from '@/lib/platform/contract/terms';
import { resolveInviteAcceptFlow } from '@/lib/platform/invite/acceptFlow';
import { buildPublicAccessRedirectHref } from '@/lib/publicAccessState';

function mapInvitationInfo(
  invitationId: string,
  info: PlatformInvitationInfo,
): PlatformContractViewData {
  return {
    invitationId,
    status: info.status,
    inviteeEmail: info.invitee_email ?? '',
    expiresAt: info.expires_at ?? null,
    proposedAccountName: info.proposed_account_name ?? null,
    monthlyRetainerCents: info.monthly_retainer_cents ?? 0,
    currency: info.currency ?? 'usd',
    proposalSnapshot: info.proposal_snapshot ?? {},
    agreementType: normalizeAgreementType(info.agreement_type),
    termsVersion: info.terms_version,
    termsSourceMarkdown: info.terms_source_markdown ?? '',
    termsSnapshotMarkdown: info.terms_snapshot_markdown ?? '',
    inviterName: info.inviter_name,
    viewedAt: info.viewed_at ?? null,
    selectedPaymentRoute: info.selected_payment_route ?? null,
    selectedPaymentRouteFeeCents: info.selected_payment_route_fee_cents,
    selectedPaymentSubtotalCents: info.selected_payment_subtotal_cents ?? null,
    selectedPaymentTotalCents: info.selected_payment_total_cents ?? null,
    recurringAnchorAt: info.recurring_anchor_at ?? null,
    firstRecurringInvoiceTargetCents: info.first_recurring_invoice_target_cents ?? null,
  };
}

export default function AcceptPlatformInvitePage() {
  const router = useRouter();
  const { id, checkout } = useLocalSearchParams<{ id: string; checkout?: string }>();
  const { user, loading: authLoading, signOut } = useAuth();
  const checkoutSuccess = checkout === 'success';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<PlatformInvitationInfo | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const activationRunIdRef = useRef(0);

  useEffect(() => {
    if (!id) {
      setError('Invalid invitation link.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    getPlatformInvitationInfo(id)
      .then((result) => {
        if (cancelled) return;
        setInfo(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load invitation.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [checkout, id]);

  const runActivationCheck = useCallback(async () => {
    if (!user?.id) return;
    const runId = ++activationRunIdRef.current;
    setActivationError(null);
    const result = await waitForInviteActivation({
      async checkMemberships() {
        const memberships = await getAccountMembershipsForUser(user.id);
        return memberships.length;
      },
    });
    if (activationRunIdRef.current !== runId) return;
    if (result.kind === 'ready') {
      router.replace('/campaigns');
      return;
    }
    if (result.kind === 'timed_out') {
      setActivationError(
        'Payment succeeded, but workspace setup is taking longer than expected. Click "Check again" in a few seconds.',
      );
      return;
    }
    setActivationError(
      result.message
        ? `We could not confirm your workspace access yet: ${result.message}`
        : 'We could not confirm your workspace access yet. Click "Check again" to retry.',
    );
  }, [router, user?.id]);

  useEffect(() => {
    if (checkout !== 'success' || !user?.id) return;
    void runActivationCheck();
  }, [checkout, runActivationCheck, user?.id]);
  const viewData = useMemo(
    () => (id && info ? mapInvitationInfo(id, info) : null),
    [id, info],
  );
  const isExpiredLike = isPlatformInviteUnavailableStatus(info?.status);
  const isCompletedLike = !checkoutSuccess && isPlatformInviteCompletedStatus(info?.status);
  const hasAuthMismatch =
    !checkoutSuccess &&
    !!user?.email &&
    !!info?.invitee_email &&
    user.email.toLowerCase() !== info.invitee_email.toLowerCase();

  const redirectHref = useMemo(() => {
    if (!id || loading || authLoading || !info) return null;
    if (isExpiredLike) {
      return buildPublicAccessRedirectHref({
        isSignedIn: !!user,
        state: {
          flow: 'platform_invite',
          issue: 'resource_unavailable',
          resourceId: id,
          inviteeEmail: info.invitee_email ?? null,
          accountName: info.proposed_account_name ?? null,
        },
      });
    }
    if (isCompletedLike) {
      return buildPublicAccessRedirectHref({
        isSignedIn: !!user,
        state: {
          flow: 'platform_invite',
          issue: 'resource_completed',
          resourceId: id,
          inviteeEmail: info.invitee_email ?? null,
          accountName: info.proposed_account_name ?? null,
        },
      });
    }
    if (hasAuthMismatch) {
      return buildPublicAccessRedirectHref({
        isSignedIn: true,
        state: {
          flow: 'platform_invite',
          issue: 'wrong_email',
          resourceId: id,
          inviteeEmail: info.invitee_email ?? null,
          accountName: info.proposed_account_name ?? null,
        },
      });
    }
    return null;
  }, [
    authLoading,
    hasAuthMismatch,
    id,
    info,
    isCompletedLike,
    isExpiredLike,
    loading,
    user,
  ]);
  const bootstrapping = loading || authLoading || !!redirectHref;
  const showBootScreen = useSmoothLoading(bootstrapping, { delayMs: 0 });

  useEffect(() => {
    if (!redirectHref) return;
    router.replace(redirectHref as any);
  }, [redirectHref, router]);

  const handleRetryActivation = useCallback(() => {
    void runActivationCheck();
  }, [runActivationCheck]);

  const redirectToAccessDestination = useCallback(
    (issue: 'resource_unavailable' | 'resource_completed' | 'wrong_email') => {
      if (!id) return;
      router.replace(
        buildPublicAccessRedirectHref({
          isSignedIn: !!user,
          state: {
            flow: 'platform_invite',
            issue,
            resourceId: id,
            inviteeEmail: info?.invitee_email ?? null,
            accountName: info?.proposed_account_name ?? null,
          },
        }) as any,
      );
    },
    [id, info?.invitee_email, info?.proposed_account_name, router, user],
  );

  const loadQuote = useCallback(
    async (paymentRoute: PlatformPaymentRoute) => {
      if (!id) {
        throw new Error('Invalid invitation link.');
      }
      return getPlatformCheckoutQuote({
        invitationId: id,
        paymentRoute,
      });
    },
    [id],
  );

  const handleCompleteCheckout = useCallback(
    async ({
      invitationId,
      paymentRoute,
      fullName,
      accountName,
      password,
      inviteEmail,
      hasMatchingAuthUser,
    }: PlatformInviteCheckoutInput) => {
      if (!invitationId) {
        throw new Error('Invalid invitation link.');
      }

      if (!hasMatchingAuthUser) {
        await ensurePlatformInviteAuthUser(invitationId, password);
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: inviteEmail,
          password,
        });
        if (signInError) throw new Error(signInError.message);
      }

      if (resolveInviteAcceptFlow(info?.monthly_retainer_cents) === 'free') {
        const result = await acceptPlatformInvitation({
          invitationId,
          fullName,
          accountName,
        });
        router.replace('/campaigns');
        return {
          kind: 'activated',
          accountId:
            result && typeof result === 'object' && 'account_id' in result
              ? (result.account_id as string | null | undefined)
              : null,
        } as const;
      }

      await preparePlatformInvitationCheckout({
        invitationId,
        fullName,
        accountName,
      });

      const origin =
        typeof window !== 'undefined'
          ? window.location.origin
          : 'https://build.getfurnace.io';
      const checkoutResult = await createPlatformCheckoutSession({
        invitationId,
        successUrl: `${origin}/accept-platform-invite/${invitationId}?checkout=success`,
        cancelUrl: `${origin}/accept-platform-invite/${invitationId}`,
        paymentRoute,
      });
      const checkoutUrl =
        typeof checkoutResult.url === 'string' ? checkoutResult.url : null;
      if (!checkoutUrl) throw new Error('Missing Stripe checkout URL.');
      if (typeof window !== 'undefined') {
        window.location.assign(checkoutUrl);
      }
      return { kind: 'redirect' } as const;
    },
    [info?.monthly_retainer_cents, router],
  );

  if (bootstrapping || showBootScreen) {
    return <AppBootScreen />;
  }

  return (
    <PlatformInviteExperience
      loading={false}
      authLoading={false}
      loadError={error}
      info={viewData}
      currentUserEmail={user?.email}
      checkoutSuccess={checkoutSuccess}
      activationError={activationError}
      onRetryActivation={checkoutSuccess ? handleRetryActivation : undefined}
      onContinueExpired={() => redirectToAccessDestination('resource_unavailable')}
      onContinueCompleted={() => redirectToAccessDestination('resource_completed')}
      onSignOut={() => {
        void signOut();
      }}
      loadQuote={loadQuote}
      onCompleteCheckout={handleCompleteCheckout}
    />
  );
}
