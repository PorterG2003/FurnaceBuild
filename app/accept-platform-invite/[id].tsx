import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlatformInviteExperience } from '@/components/platform-invite/PlatformInviteExperience';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import {
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
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type {
  PlatformInviteCheckoutInput,
  PlatformInviteViewData,
} from '@/lib/platform-invite/types';
import { normalizeAgreementType } from '@/lib/platform-invite/terms';

function mapInvitationInfo(
  invitationId: string,
  info: PlatformInvitationInfo,
): PlatformInviteViewData {
  return {
    invitationId,
    status: info.status,
    inviteeEmail: info.invitee_email ?? '',
    expiresAt: info.expires_at ?? null,
    proposedAccountName: info.proposed_account_name ?? null,
    monthlyRetainerCents: info.monthly_retainer_cents ?? 0,
    currency: info.currency ?? 'usd',
    firstMonthDiscountCents: info.first_month_discount_cents ?? 0,
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
  };
}

export default function AcceptPlatformInvitePage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, checkout } = useLocalSearchParams<{ id: string; checkout?: string }>();
  const { user, loading: authLoading, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<PlatformInvitationInfo | null>(null);

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

  useEffect(() => {
    if (checkout !== 'success' || !user?.id) return;
    let cancelled = false;

    const checkReady = async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const memberships = await getAccountMembershipsForUser(user.id);
        if (cancelled) return;
        if (memberships.length > 0) {
          router.replace('/campaigns');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    };

    void checkReady();
    return () => {
      cancelled = true;
    };
  }, [checkout, router, user?.id]);
  const viewData = useMemo(
    () => (id && info ? mapInvitationInfo(id, info) : null),
    [id, info],
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
    [],
  );

  return (
    <PlatformInviteExperience
      insets={insets}
      loading={loading}
      authLoading={authLoading}
      loadError={error}
      info={viewData}
      currentUserEmail={user?.email}
      checkoutSuccess={checkout === 'success'}
      onContinueExpired={() =>
        router.replace({
          pathname: '/invite-only',
          params: user?.email ? { email: user.email } : {},
        })
      }
      onSignOut={() => {
        void signOut();
      }}
      loadQuote={loadQuote}
      onCompleteCheckout={handleCompleteCheckout}
    />
  );
}
