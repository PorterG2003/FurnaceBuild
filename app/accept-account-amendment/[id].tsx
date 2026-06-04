import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AppBootScreen } from '@/components/ui/AppBootScreen';
import { Button } from '@/components/ui/button';
import { useSmoothLoading } from '@/components/ui/feedback/useSmoothLoading';
import { AcceptStandaloneCard } from '@/components/ui/layout';
import { useToast } from '@/components/ui/feedback';
import { PlatformAmendmentAcceptExperience } from '@/components/platform/amendment/PlatformAmendmentAcceptExperience';
import { PlatformAmendmentUpgradePaymentStep } from '@/components/platform/amendment/PlatformAmendmentUpgradePaymentStep';
import { PlatformAcceptExperience } from '@/components/platform/contract/PlatformAcceptExperience';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import type { AmendmentUpgradeQuote } from '@/lib/billing/amendmentQuote';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import { getAccountMembershipsForUser } from '@/lib/supabase/services/accounts';
import {
  isPendingAmendmentStatus,
  resolveAmendmentAcceptFlowFromBilling,
  resolveAmendmentBillingChangeKindFromBilling,
  type AmendmentBillingChangeKind,
  type AmendmentAcceptFlowKind,
} from '@/lib/platform/amendment/acceptFlow';
import { normalizeAgreementType } from '@/lib/platform/contract/terms';
import {
  acceptPlatformAccountAmendment,
  getAccountBilling,
  getPlatformAccountAmendmentInfo,
  type PlatformAccountAmendmentInfo,
} from '@/lib/supabase/services/platform';
import {
  applyAccountUpgrade,
  createAccountPaymentMethodUpdateSession,
  finalizeAccountPaymentMethodUpdate,
  getAccountUpgradeQuote,
  scheduleAccountDowngrade,
} from '@/lib/services/platform';
import { buildPublicAccessRedirectHref } from '@/lib/publicAccessState';

type OwnerPhase = 'review' | 'payment';
type PaymentPhaseState = 'initial' | 'resume' | 'recovery';

export default function AcceptAccountAmendmentPage() {
  const { id, payment_setup, session_id } = useLocalSearchParams<{
    id: string;
    payment_setup?: string;
    session_id?: string;
  }>();
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { refetchAccountData, setCurrentAccountId } = useAccount();
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<PlatformAccountAmendmentInfo | null>(null);
  const [acceptFlowKind, setAcceptFlowKind] = useState<AmendmentAcceptFlowKind>('terms_only');
  const [billingChangeKind, setBillingChangeKind] =
    useState<AmendmentBillingChangeKind>('unchanged');
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [preferredPaymentRoute, setPreferredPaymentRoute] = useState<PlatformPaymentRoute>('card');
  const [selectedPaymentRoute, setSelectedPaymentRoute] = useState<PlatformPaymentRoute>('card');
  const [upgradeQuote, setUpgradeQuote] = useState<AmendmentUpgradeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<'guest' | 'owner' | null>(null);
  const [ownerPhase, setOwnerPhase] = useState<OwnerPhase>('review');
  const [paymentPhaseState, setPaymentPhaseState] = useState<PaymentPhaseState>('initial');
  const [pendingBillingMethodToast, setPendingBillingMethodToast] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const showBootScreen = useSmoothLoading(bootstrapping, { delayMs: 0 });

  useEffect(() => {
    if (!id) {
      setLoadError('Invalid agreement link.');
      setBootstrapping(false);
      return;
    }
    if (authLoading) return;

    let cancelled = false;
    setBootstrapping(true);
    setLoadError(null);
    setInfo(null);
    setRenderMode(null);
    setAcceptFlowKind('terms_only');
    setBillingChangeKind('unchanged');
    setBillingStatus(null);
    setPreferredPaymentRoute('card');
    setSelectedPaymentRoute('card');
    setUpgradeQuote(null);
    setQuoteError(null);
    setOwnerPhase('review');
    setPaymentPhaseState('initial');
    setPendingBillingMethodToast(false);

    void (async () => {
      try {
        const result = await getPlatformAccountAmendmentInfo(id);
        if (cancelled) return;
        setInfo(result);

        switch (result.status) {
          case 'not_found':
          case 'unavailable':
            router.replace(
              buildPublicAccessRedirectHref({
                isSignedIn: !!user,
                state: {
                  flow: 'account_amendment',
                  issue: 'resource_unavailable',
                  resourceId: id,
                  accountName: result.account_name ?? null,
                },
              }) as any,
            );
            return;
          case 'pending_acceptance':
          case 'pending_payment':
            if (!user) {
              setRenderMode('guest');
              setOwnerPhase(result.status === 'pending_payment' ? 'payment' : 'review');
              setPaymentPhaseState(result.status === 'pending_payment' ? 'resume' : 'initial');
              setBootstrapping(false);
              return;
            }

            if (!result.account_id) {
              router.replace(
                buildPublicAccessRedirectHref({
                  isSignedIn: true,
                  state: {
                    flow: 'account_amendment',
                    issue: 'resource_unavailable',
                    resourceId: id,
                    accountName: result.account_name ?? null,
                  },
                }) as any,
              );
              return;
            }

            const memberships = await getAccountMembershipsForUser(user.id);
            if (cancelled) return;

            const membership = memberships.find((entry) => entry.account.id === result.account_id);
            if (!membership?.membership.is_owner) {
              router.replace(
                buildPublicAccessRedirectHref({
                  isSignedIn: true,
                  state: {
                    flow: 'account_amendment',
                    issue: 'not_owner',
                    resourceId: id,
                    accountName: result.account_name ?? null,
                  },
                }) as any,
              );
              return;
            }

            if (payment_setup === 'success' && typeof session_id === 'string' && session_id.trim()) {
              await finalizeAccountPaymentMethodUpdate({
                checkoutSessionId: session_id,
              });
              if (cancelled) return;
              setPendingBillingMethodToast(true);
            }

            const billing = await getAccountBilling(result.account_id);
            if (cancelled) return;

            setCurrentAccountId(result.account_id);
            const nextFlowKind = billing
              ? resolveAmendmentAcceptFlowFromBilling(billing, {
                  monthly_retainer_cents: result.proposed_monthly_retainer_cents ?? 0,
                  agreement_type: normalizeAgreementType(result.agreement_type),
                  proposal_snapshot_json: result.proposal_snapshot_json ?? {},
                })
              : 'terms_only';
            const nextBillingChangeKind = billing
              ? resolveAmendmentBillingChangeKindFromBilling(billing, {
                  monthly_retainer_cents: result.proposed_monthly_retainer_cents ?? 0,
                  agreement_type: normalizeAgreementType(result.agreement_type),
                  proposal_snapshot_json: result.proposal_snapshot_json ?? {},
                })
              : 'unchanged';
            setAcceptFlowKind(
              nextFlowKind,
            );
            setBillingChangeKind(nextBillingChangeKind);
            setBillingStatus(billing?.billing_status ?? null);
            const nextPaymentRoute =
              billing?.preferred_payment_route ?? result.preferred_payment_route ?? 'card';
            setPreferredPaymentRoute(nextPaymentRoute);
            setSelectedPaymentRoute(nextPaymentRoute);
            setPaymentPhaseState(
              result.status === 'pending_payment'
                ? billing?.billing_status === 'payment_required'
                  ? 'recovery'
                  : 'resume'
                : 'initial',
            );
            setOwnerPhase(
              result.status === 'pending_payment' && nextBillingChangeKind === 'upgrade'
                ? 'payment'
                : 'review',
            );
            setRenderMode('owner');
            setBootstrapping(false);
            return;
          default:
            setLoadError(`Unexpected amendment status: ${result.status}`);
            setBootstrapping(false);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading amendment:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load agreement update.');
        setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, id, payment_setup, reloadKey, router, session_id, setCurrentAccountId, user]);

  useEffect(() => {
    if (renderMode !== 'owner') return;
    if (billingChangeKind !== 'upgrade') return;
    if (ownerPhase !== 'payment') return;
    if (!info?.account_id || !info.proposed_monthly_retainer_cents) return;

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);

    void getAccountUpgradeQuote({
      accountId: info.account_id,
      amendmentId: info.amendment_id ?? id ?? null,
      newMonthlyRetainerCents: info.proposed_monthly_retainer_cents,
      paymentRoute: selectedPaymentRoute,
    })
      .then((quote) => {
        if (cancelled) return;
        setUpgradeQuote(quote);
      })
      .catch((err) => {
        if (cancelled) return;
        setUpgradeQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Failed to load billing preview.');
      })
      .finally(() => {
        if (!cancelled) {
          setQuoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [billingChangeKind, id, info?.account_id, info?.amendment_id, info?.proposed_monthly_retainer_cents, ownerPhase, renderMode, selectedPaymentRoute]);

  useEffect(() => {
    if (!pendingBillingMethodToast) return;
    if (renderMode !== 'owner') return;

    toast.success('Default billing method updated. Review the refreshed quote, then confirm payment.');
    setPendingBillingMethodToast(false);

    if (id) {
      router.replace(`/accept-account-amendment/${id}` as any);
    }
  }, [id, pendingBillingMethodToast, renderMode, router, toast]);

  const navigateToAuth = (mode: 'signIn' | 'signUp') => {
    const base = `/auth?amendment_id=${encodeURIComponent(id ?? '')}`;
    const params =
      mode === 'signUp' ? `${base}&mode=signUp` : base;
    router.replace(params as any);
  };

  const handleAccept = async () => {
    if (!id || !info?.amendment_id || !info.account_id) return;
    setSaving(true);

    try {
      const result = await acceptPlatformAccountAmendment({
        amendmentId: id,
        termsAcceptedIp: null,
      });

      if (result.requires_stripe_apply && result.billing_change_kind === 'downgrade') {
        await scheduleAccountDowngrade({
          accountId: result.account_id,
          newMonthlyRetainerCents: result.new_monthly_retainer_cents!,
        });
      }

      toast.success(
        result.billing_change_kind === 'downgrade'
          ? 'Agreement accepted. The lower retainer is scheduled for the next billing cycle.'
          : 'Agreement accepted.',
      );
      await refetchAccountData();
      router.replace('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept terms.');
      await refetchAccountData();
    } finally {
      setSaving(false);
    }
  };

  const handleContinueFromReview = async () => {
    if (billingChangeKind === 'upgrade') {
      if (!id) return;
      if (info?.status === 'pending_payment') {
        setPaymentPhaseState(billingStatus === 'payment_required' ? 'recovery' : 'resume');
        setOwnerPhase('payment');
        return;
      }
      setSaving(true);
      try {
        const result = await acceptPlatformAccountAmendment({
          amendmentId: id,
          termsAcceptedIp: null,
        });
        if (result.billing_change_kind !== 'upgrade' || !result.requires_stripe_apply) {
          throw new Error('This agreement no longer requires payment. Please reload and try again.');
        }
        setInfo((current) =>
          current
            ? {
                ...current,
                status: 'pending_payment',
                amendment_id: result.amendment_id ?? current.amendment_id,
                account_id: result.account_id ?? current.account_id,
                proposed_monthly_retainer_cents:
                  result.new_monthly_retainer_cents ?? current.proposed_monthly_retainer_cents,
                payment_started_at: result.payment_started_at ?? current.payment_started_at,
                preferred_payment_route:
                  result.preferred_payment_route ?? current.preferred_payment_route,
              }
            : current,
        );
        setPreferredPaymentRoute(result.preferred_payment_route ?? preferredPaymentRoute);
        setSelectedPaymentRoute(result.preferred_payment_route ?? preferredPaymentRoute);
        setPaymentPhaseState('initial');
        setOwnerPhase('payment');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to continue to payment.');
      } finally {
        setSaving(false);
      }
      return;
    }
    await handleAccept();
  };

  const handleConfirmPayment = async () => {
    if (!id || !info?.account_id || !info.proposed_monthly_retainer_cents) return;
    if (info.status !== 'pending_payment') {
      toast.error('Review the agreement first, then continue to payment.');
      return;
    }

    if (selectedPaymentRoute !== preferredPaymentRoute) {
      await handleUpdatePaymentMethod(selectedPaymentRoute);
      return;
    }

    setSaving(true);

    try {
      const result = await applyAccountUpgrade({
        accountId: info.account_id,
        amendmentId: info.amendment_id ?? id,
        newMonthlyRetainerCents: info.proposed_monthly_retainer_cents,
      });

      if (
        result &&
        typeof result === 'object' &&
        (result as { paymentRoute?: string; chargeStatus?: string }).paymentRoute === 'ach' &&
        (result as { chargeStatus?: string }).chargeStatus !== 'paid'
      ) {
        toast.success(
          'Agreement accepted. The ACH payment is processing and the upgrade is now live.',
        );
      } else {
        toast.success('Agreement accepted and billing updated.');
      }
      await refetchAccountData();
      router.replace('/');
    } catch (err) {
      setInfo((current) => (current ? { ...current, status: 'pending_payment' } : current));
      setPaymentPhaseState('resume');
      setOwnerPhase('payment');
      toast.error(err instanceof Error ? err.message : 'Failed to complete payment.');
      await refetchAccountData();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePaymentMethod = async (paymentRoute: PlatformPaymentRoute) => {
    if (!id || !info?.account_id) return;
    setSaving(true);
    try {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'https://build.getfurnace.io';
      const result = await createAccountPaymentMethodUpdateSession({
        accountId: info.account_id,
        amendmentId: info.amendment_id ?? id,
        paymentRoute,
        successUrl: `${origin}/accept-account-amendment/${id}?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/accept-account-amendment/${id}`,
      });
      const checkoutUrl = typeof result.url === 'string' ? result.url : null;
      if (!checkoutUrl) {
        throw new Error('Missing Stripe checkout URL.');
      }
      if (typeof window !== 'undefined') {
        window.location.assign(checkoutUrl);
        return;
      }
      throw new Error('Billing method updates are only supported on web right now.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start billing method update.');
      setSaving(false);
    }
  };

  const accountName = info?.account_name?.trim() || 'your workspace';
  const isUpgrade = billingChangeKind === 'upgrade';
  const canReturnToReview = isUpgrade && ownerPhase === 'payment';

  const renderPendingGuestCard = () => {
    if (!info || !isPendingAmendmentStatus(info.status)) return null;
    const isPaymentStep = info.status === 'pending_payment';

    return (
      <AcceptStandaloneCard
        actions={
          authLoading ? (
            <ActivityIndicator size="small" color="#f33203" />
          ) : !user ? (
            <>
              <Text className="text-gray-300 text-sm font-instrument text-center leading-5">
                Sign in as the account owner to review and accept.
              </Text>
              <Button onPress={() => navigateToAuth('signIn')} variant="default">
                Sign in
              </Button>
              <Button onPress={() => navigateToAuth('signUp')} variant="outline">
                Create account
              </Button>
            </>
          ) : null
        }
      >
        <Text className="text-brand-orange text-xs font-instrument-semibold uppercase tracking-wider">
          Agreement update
        </Text>
        <Text className="text-white text-2xl font-instrument-bold">{accountName}</Text>
        <Text className="text-gray-300 text-sm font-instrument leading-5">
          {isPaymentStep
            ? 'The account owner has already reviewed this update. They still need to choose a payment method and confirm payment before the agreement can take effect.'
            : 'Furnace has updated the contract for this workspace. The account owner needs to review the changes and accept before the team can continue.'}
        </Text>
      </AcceptStandaloneCard>
    );
  };

  const renderPublicContent = () => {
    if (renderMode === 'guest') {
      return renderPendingGuestCard();
    }

    if (loadError) {
      return (
        <AcceptStandaloneCard
          actions={
            <Button
              onPress={() => {
                setReloadKey((current) => current + 1);
              }}
              variant="default"
            >
              Try again
            </Button>
          }
        >
          <Text className="text-white text-2xl font-instrument-bold text-center">
            Something went wrong
          </Text>
          <Text className="text-red-400 text-base font-instrument text-center leading-5">
            {loadError}
          </Text>
        </AcceptStandaloneCard>
      );
    }

    return (
      <AcceptStandaloneCard
        actions={
          <Button
            onPress={() => {
              setReloadKey((current) => current + 1);
            }}
            variant="default"
          >
            Try again
          </Button>
        }
      >
        <Text className="text-white text-2xl font-instrument-bold text-center">
          Something went wrong
        </Text>
        <Text className="text-gray-400 text-base font-instrument text-center leading-5">
          We could not load this agreement update. Please try again.
        </Text>
      </AcceptStandaloneCard>
    );
  };

  if (bootstrapping || showBootScreen) {
    return <AppBootScreen />;
  }

  const showOwnerAcceptUi = renderMode === 'owner' && !!info && isPendingAmendmentStatus(info.status);

  if (showOwnerAcceptUi && info) {
    if (isUpgrade && ownerPhase === 'payment') {
      return (
        <PlatformAmendmentUpgradePaymentStep
          info={info}
          quote={upgradeQuote}
          quoteLoading={quoteLoading}
          quoteError={quoteError}
          saving={saving}
          paymentPhaseState={paymentPhaseState}
          billingStatus={billingStatus}
          paymentRoute={selectedPaymentRoute}
          savedPaymentRoute={preferredPaymentRoute}
          onSelectPaymentRoute={setSelectedPaymentRoute}
          onBack={canReturnToReview ? () => setOwnerPhase('review') : undefined}
          onConfirm={() => void handleConfirmPayment()}
        />
      );
    }

    return (
      <PlatformAmendmentAcceptExperience
        info={info}
        acceptFlowKind={acceptFlowKind}
        billingChangeKind={billingChangeKind}
        ownerPhase={ownerPhase}
        saving={saving}
        onContinue={() => void handleContinueFromReview()}
      />
    );
  }

  return (
    <PlatformAcceptExperience contentMode="transparent" bodyMaxWidthClassName="max-w-md">
      {renderPublicContent()}
    </PlatformAcceptExperience>
  );
}
