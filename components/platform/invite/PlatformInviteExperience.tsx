import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import {
  authInputClassName,
  authInputStyle,
  authLabelClassName,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { normalizeProposalSnapshot, formatUsd } from '@/components/platform/admin/shared';
import { PlatformAcceptExperience } from '@/components/platform/contract/PlatformAcceptExperience';
import {
  PlatformPaymentBreakdown,
  type PlatformPaymentBreakdownRow,
  type PlatformPaymentBreakdownSection,
} from '@/components/platform/contract/PlatformPaymentBreakdown';
import { PlatformContractReviewFlow } from '@/components/platform/contract/PlatformContractReviewFlow';
import { PlatformInviteLogoBar } from '@/components/platform/contract/PlatformInviteLogoBar';
import { PlatformPaymentRouteSelector } from '@/components/platform/contract/PlatformPaymentRouteSelector';
import { getPlatformPaymentRouteOption, type PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { PlatformCheckoutQuote } from '@/lib/services/platform';
import {
  INVITE_FLOW_TEXT_INPUT_STYLE,
} from '@/lib/platform/contract/interactionStyles';
import {
  isPlatformInviteCompletedStatus,
  isPlatformInviteUnavailableStatus,
} from '@/lib/platform/invite/accessState';
import { resolveInviteAcceptFlow } from '@/lib/platform/invite/acceptFlow';
import type {
  PlatformInviteCheckoutInput,
  PlatformInviteCheckoutResult,
  PlatformInviteStep,
  PlatformContractViewData,
} from '@/lib/platform/contract/types';

export function PlatformInviteExperience({
  loading,
  authLoading = false,
  loadError,
  info,
  currentUserEmail,
  checkoutSuccess = false,
  activationError = null,
  mode = 'live',
  embedded = false,
  onContinueExpired,
  onContinueCompleted = () => {},
  onSignOut,
  onRetryActivation,
  loadQuote,
  onCompleteCheckout,
}: {
  loading: boolean;
  authLoading?: boolean;
  loadError?: string | null;
  info: PlatformContractViewData | null;
  currentUserEmail?: string | null;
  checkoutSuccess?: boolean;
  activationError?: string | null;
  mode?: 'live' | 'preview';
  embedded?: boolean;
  onContinueExpired: () => void;
  onContinueCompleted?: () => void;
  onSignOut?: () => void | Promise<void>;
  onRetryActivation?: () => void;
  loadQuote: (paymentRoute: PlatformPaymentRoute) => Promise<PlatformCheckoutQuote>;
  onCompleteCheckout: (
    input: PlatformInviteCheckoutInput,
  ) => Promise<PlatformInviteCheckoutResult>;
}) {
  const [step, setStep] = useState<PlatformInviteStep>('proposal');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [fullName, setFullName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentRoute, setPaymentRoute] = useState<PlatformPaymentRoute>('card');
  const [quote, setQuote] = useState<PlatformCheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [previewActivationMessage, setPreviewActivationMessage] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const normalizedProposal = useMemo(
    () => normalizeProposalSnapshot(info?.proposalSnapshot),
    [info?.proposalSnapshot],
  );
  const showsProposalStep = info?.agreementType === 'managed_services_agreement';
  const inviteAcceptFlow = resolveInviteAcceptFlow(info?.monthlyRetainerCents);
  const isFreeFlow = inviteAcceptFlow === 'free';
  const clientLogoUrl = normalizedProposal.client_logo_url;
  const clientLogoScale = normalizedProposal.client_logo_scale;
  const clientLogoOffsetX = normalizedProposal.client_logo_offset_x;

  useEffect(() => {
    setPaymentRoute(info?.selectedPaymentRoute ?? 'card');
    setStep(checkoutSuccess ? 'activating' : showsProposalStep ? 'proposal' : 'terms');
    setTermsAccepted(false);
    setFullName('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setPreviewActivationMessage(null);
    if (info?.proposedAccountName) {
      setAccountName(info.proposedAccountName);
    } else {
      setAccountName('');
    }
  }, [
    checkoutSuccess,
    info?.invitationId,
    info?.proposedAccountName,
    info?.selectedPaymentRoute,
    showsProposalStep,
  ]);

  useEffect(() => {
    const blockedStatuses =
      mode === 'preview'
        ? ['expired', 'revoked', 'not_found']
        : ['expired', 'revoked', 'not_found', 'draft', 'active'];
    if (!info || blockedStatuses.includes(info.status)) {
      return;
    }
    if (isFreeFlow) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    loadQuote(paymentRoute)
      .then((result) => {
        if (!cancelled) {
          setQuote(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : 'Failed to load payment total.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setQuoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [info, isFreeFlow, loadQuote, mode, paymentRoute]);

  const inviteEmail = info?.inviteeEmail ?? '';
  const isExpiredLike = isPlatformInviteUnavailableStatus(info?.status);
  const isCompletedLike = !checkoutSuccess && isPlatformInviteCompletedStatus(info?.status);
  const hasMatchingAuthUser =
    !!currentUserEmail && currentUserEmail.toLowerCase() === inviteEmail.toLowerCase();
  const authMismatch =
    mode === 'live' &&
    !!currentUserEmail &&
    inviteEmail &&
    currentUserEmail.toLowerCase() !== inviteEmail.toLowerCase();
  const activeRouteOption = useMemo(
    () => getPlatformPaymentRouteOption(paymentRoute),
    [paymentRoute],
  );
  const recurringAnchorLabel = useMemo(() => {
    if (!quote?.recurringAnchorAt) return 'next billing date';
    return new Date(quote.recurringAnchorAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [quote?.recurringAnchorAt]);
  const priceSections = useMemo(() => {
    const sections: PlatformPaymentBreakdownSection[] = [];
    if (!quote) return sections;

    const dueTodayRows: PlatformPaymentBreakdownRow[] = [
      { label: 'Monthly retainer', value: formatUsd(quote.monthlyRetainerCents) },
    ];
    if (quote.routeFeeCents > 0) {
      dueTodayRows.push({
        label: `${activeRouteOption.label} processing fee`,
        value: formatUsd(quote.routeFeeCents),
      });
    }
    dueTodayRows.push({
      label: 'Total due today',
      value: formatUsd(quote.totalDueTodayCents),
      emphasize: true,
    });
    sections.push({
      title: 'Due today',
      rows: dueTodayRows,
    });

    const futureInvoiceRows: PlatformPaymentBreakdownRow[] = [];
    if (quote.firstRecurringRouteFeeCents > 0) {
      futureInvoiceRows.push({
        label:
          quote.firstRecurringDiscountCents > 0
            ? `Invoice subtotal on ${recurringAnchorLabel} (after overlap credit)`
            : `Invoice subtotal on ${recurringAnchorLabel}`,
        value: formatUsd(quote.firstRecurringSubtotalCents),
      });
      futureInvoiceRows.push({
        label: `${activeRouteOption.label} processing fee on ${recurringAnchorLabel}`,
        value: formatUsd(quote.firstRecurringRouteFeeCents),
      });
      futureInvoiceRows.push({
        label: `Total due on ${recurringAnchorLabel}`,
        value: formatUsd(quote.firstRecurringInvoiceCents),
        emphasize: true,
      });
      futureInvoiceRows.push({
        label: 'Later monthly subtotal',
        value: formatUsd(quote.ongoingMonthlyRetainerCents),
      });
      futureInvoiceRows.push({
        label: `${activeRouteOption.label} processing fee on later invoices`,
        value: formatUsd(quote.ongoingMonthlyRouteFeeCents),
      });
      futureInvoiceRows.push({
        label: 'Later monthly total',
        value: formatUsd(quote.ongoingMonthlyTotalCents),
      });
    } else {
      if (quote.firstRecurringDiscountCents > 0) {
        futureInvoiceRows.push({
          label: `Overlap credit on ${recurringAnchorLabel}`,
          value: `-${formatUsd(quote.firstRecurringDiscountCents)}`,
        });
      }
      futureInvoiceRows.push({
        label: `Amount due on ${recurringAnchorLabel}`,
        value: formatUsd(quote.firstRecurringInvoiceCents),
      });
      futureInvoiceRows.push({
        label: 'Later monthly invoices',
        value: formatUsd(quote.ongoingMonthlyTotalCents),
      });
    }
    sections.push({
      title: 'Future invoices',
      rows: futureInvoiceRows,
    });

    return sections;
  }, [activeRouteOption.label, quote, recurringAnchorLabel]);
  const isProposalStep = showsProposalStep && step === 'proposal';

  const handleContinueToCheckout = async () => {
    if (!inviteEmail) return;
    if (!termsAccepted) {
      setError('You must agree to the agreement before continuing.');
      return;
    }
    if (!isFreeFlow && !quote) {
      setError('Pricing is still loading. Please wait a moment and try again.');
      return;
    }
    if (!fullName.trim() || !accountName.trim()) {
      setError('Full name and company name are required.');
      return;
    }
    if (!hasMatchingAuthUser) {
      if (!password || !confirmPassword) {
        setError('Password and confirmation are required.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await onCompleteCheckout({
        invitationId: info?.invitationId,
        paymentRoute,
        fullName: fullName.trim(),
        accountName: accountName.trim(),
        password,
        inviteEmail,
        hasMatchingAuthUser,
      });

      if (result.kind === 'preview_complete') {
        setPreviewActivationMessage({
          title: result.title ?? 'Preview complete',
          message:
            result.message ??
            'Preview mode does not publish the invite or start a checkout session.',
        });
        setStep('activating');
      } else if (result.kind === 'activated') {
        setPreviewActivationMessage({
          title: 'Workspace ready',
          message: 'Your workspace is ready. Redirecting now.',
        });
        setStep('activating');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isFreeFlow
            ? 'Failed to create your workspace.'
            : 'Failed to continue to payment.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderPriceSummary = () => {
    if (quoteLoading) {
      return (
        <View className="items-center justify-center py-6">
          <ActivityIndicator size="small" color="#f85102" />
          <Text selectable={false} className="text-gray-300 font-instrument mt-3">
            Updating your total...
          </Text>
        </View>
      );
    }

    if (!quote) {
      return (
        <Alert
          variant="error"
          message={quoteError || 'Unable to load pricing for this payment route.'}
        />
      );
    }

    return <PlatformPaymentBreakdown sections={priceSections} />;
  };

  const renderStepBody = () => {
    if (loading || authLoading) {
      return (
        <View className="items-center justify-center py-16">
          <ActivityIndicator size="large" color="#f85102" />
          <Text selectable={false} className="text-gray-300 font-instrument mt-4">
            Loading your invitation...
          </Text>
        </View>
      );
    }

    if (loadError && !info) {
      return <Alert variant="error" message={loadError} />;
    }

    if (isExpiredLike) {
      return (
        <View className="gap-4">
          <Alert
            variant="warning"
            message="This invite is no longer available. Furnace is invite only. Look in your email for an active invite, or book a call if you are new."
          />
          <Button onPress={onContinueExpired}>Continue</Button>
        </View>
      );
    }

    if (isCompletedLike) {
      return (
        <View className="gap-4">
          <Alert
            variant="info"
            message="This invitation was already accepted. Open your workspace to continue."
          />
          <Button onPress={onContinueCompleted}>Open workspace</Button>
        </View>
      );
    }

    if (step === 'activating') {
      const title = previewActivationMessage?.title ?? 'Activating your workspace';
      const message =
        previewActivationMessage?.message ??
        (isFreeFlow
          ? 'We are provisioning your account now.'
          : 'Payment succeeded. We are provisioning your account now.');
      if (activationError) {
        return (
          <View className="gap-4 py-8">
            <Alert variant="warning" message={activationError} />
            {onRetryActivation ? <Button onPress={onRetryActivation}>Check again</Button> : null}
          </View>
        );
      }
      return (
        <View className="items-center justify-center py-12">
          <ActivityIndicator size="large" color="#f85102" />
          <Text selectable={false} className="text-white text-xl font-instrument-semibold mt-6 mb-2">
            {title}
          </Text>
          <Text selectable={false} className="text-center text-gray-300 font-instrument">
            {message}
          </Text>
        </View>
      );
    }

    if (authMismatch) {
      return (
        <View className="gap-4">
          <Alert
            variant="warning"
            message={`You are signed in as ${currentUserEmail}. This invite is for ${inviteEmail}.`}
          />
          <Button
            onPress={() => {
              if (onSignOut) {
                void onSignOut();
              }
            }}
          >
            Sign out and continue
          </Button>
        </View>
      );
    }

    if (step === 'proposal' || step === 'terms') {
      return (
        <PlatformContractReviewFlow
          agreementType={info?.agreementType}
          proposalSnapshot={info?.proposalSnapshot}
          termsMarkdown={info?.termsSnapshotMarkdown}
          showProposalStep={showsProposalStep}
          initialStep={step === 'terms' ? 'terms' : 'proposal'}
          termsAccepted={termsAccepted}
          onTermsAcceptedChange={setTermsAccepted}
          termsAcceptanceLabel={
            isFreeFlow
              ? 'I have reviewed this agreement, and I agree that creating this workspace will make it binding.'
              : 'I have reviewed this agreement, and I agree that completing payment will make it binding.'
          }
          continueLabel="Continue"
          onContinue={() => setStep(isFreeFlow ? 'account' : 'payment')}
          onStepChange={setStep}
        />
      );
    }

    if (step === 'payment') {
      return (
        <View className="gap-6">
          <View>
            <Text selectable={false} className="text-3xl font-instrument-semibold text-white mb-2">
              Choose a payment method
            </Text>
          </View>

          <PlatformPaymentRouteSelector
            selectedRoute={paymentRoute}
            onSelect={setPaymentRoute}
            disabled={quoteLoading}
          />

          <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
            {renderPriceSummary()}
          </View>

          <View className="flex-row gap-3">
            <Button variant="outline" className="flex-1" onPress={() => setStep('terms')}>
              Back
            </Button>
            <Button
              className="flex-1"
              onPress={() => setStep('account')}
              disabled={quoteLoading || !quote}
            >
              Continue
            </Button>
          </View>
        </View>
      );
    }

    return (
      <View className="gap-6">
        <View>
          <Text selectable={false} className="text-3xl font-instrument-semibold text-white mb-2">
            Create your login
          </Text>
          <Text selectable={false} className="text-gray-300 font-instrument">
            {isFreeFlow
              ? 'Set up your Furnace owner account, and we will create your workspace right away.'
              : 'Set up your Furnace owner account, then continue to your selected payment route.'}
          </Text>
        </View>

        <View>
          <Text selectable={false} className={authLabelClassName}>
            Invite email
          </Text>
          <TextInput
            value={inviteEmail}
            editable={false}
            className={authInputClassName}
            style={{
              ...authInputStyle,
              borderColor: '#2A2A2A',
              color: '#9CA3AF',
              ...INVITE_FLOW_TEXT_INPUT_STYLE,
            }}
          />
        </View>

        <View>
          <Text selectable={false} className={authLabelClassName}>
            Full name
          </Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            placeholderTextColor={authPlaceholderColor}
            className={authInputClassName}
            style={[authInputStyle, INVITE_FLOW_TEXT_INPUT_STYLE]}
          />
        </View>

        <View>
          <Text selectable={false} className={authLabelClassName}>
            Company or workspace name
          </Text>
          <TextInput
            value={accountName}
            onChangeText={setAccountName}
            placeholder="Enter your company name"
            placeholderTextColor={authPlaceholderColor}
            className={authInputClassName}
            style={[authInputStyle, INVITE_FLOW_TEXT_INPUT_STYLE]}
          />
        </View>

        {!hasMatchingAuthUser ? (
          <>
            <View>
              <Text selectable={false} className={authLabelClassName}>
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Create a password"
                placeholderTextColor={authPlaceholderColor}
                secureTextEntry
                className={authInputClassName}
                style={[authInputStyle, INVITE_FLOW_TEXT_INPUT_STYLE]}
              />
            </View>

            <View>
              <Text selectable={false} className={authLabelClassName}>
                Confirm password
              </Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm your password"
                placeholderTextColor={authPlaceholderColor}
                secureTextEntry
                className={authInputClassName}
                style={[authInputStyle, INVITE_FLOW_TEXT_INPUT_STYLE]}
              />
            </View>
          </>
        ) : (
          <Alert
            variant="info"
            message={`Signed in as ${currentUserEmail}. We will use this login for your new workspace.`}
          />
        )}

        {error ? <Alert variant="error" message={error} /> : null}

        <View className="flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => setStep(isFreeFlow ? 'terms' : 'payment')}
            disabled={submitting}
          >
            Back
          </Button>
          <Button
            className="flex-1"
            onPress={handleContinueToCheckout}
            disabled={submitting || (!isFreeFlow && (quoteLoading || !quote))}
          >
            {submitting
              ? mode === 'preview'
                ? 'Opening preview...'
                : isFreeFlow
                  ? 'Creating workspace...'
                  : 'Starting payment...'
              : mode === 'preview'
                ? (isFreeFlow ? 'Preview free workspace' : `Preview ${activeRouteOption.label.toLowerCase()} checkout`)
                : (isFreeFlow ? 'Create workspace' : activeRouteOption.checkoutButtonLabel)}
          </Button>
        </View>
      </View>
    );
  };

  return (
    <PlatformAcceptExperience
      embedded={embedded}
      contentMode={isProposalStep ? 'transparent' : 'framed'}
      logoBar={
        <View className={`w-full items-center ${clientLogoUrl ? 'max-w-3xl' : 'max-w-[220px]'}`}>
          <PlatformInviteLogoBar
            clientLogoUrl={clientLogoUrl}
            clientLogoScale={clientLogoScale}
            clientLogoOffsetX={clientLogoOffsetX}
          />
        </View>
      }
      note={
        mode === 'preview' ? (
          <Text
            selectable={false}
            className="mt-3 text-xs font-instrument-medium uppercase tracking-[2px] text-gray-500"
          >
            Admin preview
          </Text>
        ) : undefined
      }
    >
      {renderStepBody()}
    </PlatformAcceptExperience>
  );
}
