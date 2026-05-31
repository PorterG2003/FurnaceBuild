import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { HeroHeatShimmer, EmberParticlesLite } from '@/components/ui/effects';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Alert } from '@/components/ui/feedback';
import {
  authInputClassName,
  authInputStyle,
  authLabelClassName,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { PlatformProposalPreview } from '@/components/admin/account-management/PlatformProposalPreview';
import { normalizeProposalSnapshot, formatUsd } from '@/components/admin/account-management/shared';
import { PlatformInviteLogoBar } from '@/components/platform-invite/PlatformInviteLogoBar';
import { PlatformTermsMarkdown } from '@/components/platform-invite/PlatformTermsMarkdown';
import {
  getPlatformPaymentRouteOption,
  PLATFORM_PAYMENT_ROUTE_OPTIONS,
  type PlatformPaymentRoute,
} from '@/lib/billing/paymentRoutes';
import type { PlatformCheckoutQuote } from '@/lib/services/platform';
import {
  INVITE_FLOW_NON_SELECTABLE_STYLE,
  INVITE_FLOW_TEXT_INPUT_STYLE,
} from '@/lib/platform-invite/interactionStyles';
import type {
  PlatformInviteCheckoutInput,
  PlatformInviteCheckoutResult,
  PlatformInviteStep,
  PlatformInviteViewData,
} from '@/lib/platform-invite/types';

type PriceRow = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export function PlatformInviteExperience({
  insets,
  loading,
  authLoading = false,
  loadError,
  info,
  currentUserEmail,
  checkoutSuccess = false,
  mode = 'live',
  embedded = false,
  onContinueExpired,
  onSignOut,
  loadQuote,
  onCompleteCheckout,
}: {
  insets: EdgeInsets;
  loading: boolean;
  authLoading?: boolean;
  loadError?: string | null;
  info: PlatformInviteViewData | null;
  currentUserEmail?: string | null;
  checkoutSuccess?: boolean;
  mode?: 'live' | 'preview';
  embedded?: boolean;
  onContinueExpired: () => void;
  onSignOut?: () => void | Promise<void>;
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
        : ['expired', 'revoked', 'not_found', 'draft', 'approved'];
    if (!info || blockedStatuses.includes(info.status)) {
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
  }, [info, loadQuote, mode, paymentRoute]);

  const inviteEmail = info?.inviteeEmail ?? '';
  const isExpiredLike =
    info?.status === 'expired' || info?.status === 'revoked' || info?.status === 'not_found';
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
  const priceRows = useMemo(() => {
    const rows: PriceRow[] = [];
    if (!quote) return rows;

    rows.push({ label: 'Monthly retainer', value: formatUsd(quote.monthlyRetainerCents) });
    if (quote.firstMonthDiscountCents > 0) {
      rows.push({
        label: 'First-month discount',
        value: `-${formatUsd(quote.firstMonthDiscountCents)}`,
      });
    }
    if (quote.routeFeeCents > 0) {
      rows.push({
        label: `${activeRouteOption.label} processing fee`,
        value: formatUsd(quote.routeFeeCents),
      });
    }
    rows.push({
      label: 'Total due today',
      value: formatUsd(quote.totalDueTodayCents),
      emphasize: true,
    });
    return rows;
  }, [activeRouteOption.label, quote]);
  const isProposalStep = showsProposalStep && step === 'proposal';

  const handleContinueToCheckout = async () => {
    if (!inviteEmail) return;
    if (!termsAccepted) {
      setError('You must agree to the agreement before continuing.');
      return;
    }
    if (!quote) {
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue to payment.');
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

    return (
      <View className="gap-3">
        {priceRows.map((row) => (
          <View key={row.label} className="flex-row items-center justify-between gap-4">
            <Text
              selectable={false}
              className={`font-instrument ${
                row.emphasize ? 'text-white text-base font-instrument-semibold' : 'text-gray-300'
              }`}
            >
              {row.label}
            </Text>
            <Text
              selectable={false}
              className={`font-instrument ${
                row.emphasize ? 'text-white text-lg font-instrument-semibold' : 'text-gray-300'
              }`}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    );
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

    if (step === 'activating') {
      const title = previewActivationMessage?.title ?? 'Activating your workspace';
      const message =
        previewActivationMessage?.message ??
        'Payment succeeded. We are provisioning your account now.';
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

    if (showsProposalStep && step === 'proposal') {
      return (
        <PlatformProposalPreview
          proposalSnapshot={info?.proposalSnapshot}
          footer={
            <Button onPress={() => setStep('terms')}>Review terms &amp; continue</Button>
          }
        />
      );
    }

    if (step === 'terms') {
      return (
        <View className="gap-6">
          <PlatformTermsMarkdown markdown={info?.termsSnapshotMarkdown || 'Terms will be attached here.'} />

          <View className="flex-row items-center gap-3">
            <Checkbox
              checked={termsAccepted}
              onPress={() => setTermsAccepted((current) => !current)}
            />
            <Pressable
              className="flex-1"
              onPress={() => setTermsAccepted((current) => !current)}
            >
              <Text selectable={false} className="text-gray-300 font-instrument">
                I have reviewed this agreement, and I agree that completing payment will make it
                binding.
              </Text>
            </Pressable>
          </View>

          <View className="flex-row gap-3">
            {showsProposalStep ? (
              <Button variant="outline" className="flex-1" onPress={() => setStep('proposal')}>
                Back
              </Button>
            ) : null}
            <Button className="flex-1" onPress={() => setStep('payment')} disabled={!termsAccepted}>
              Continue
            </Button>
          </View>
        </View>
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

          <View className="gap-3">
            {PLATFORM_PAYMENT_ROUTE_OPTIONS.map((option) => {
              const selected = option.id === paymentRoute;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setPaymentRoute(option.id)}
                  className={`rounded-2xl border p-4 ${
                    selected
                      ? 'border-brand-orange bg-[#22160F]'
                      : 'border-[#2A2A2A] bg-[#181818]'
                  }`}
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text selectable={false} className="text-white text-lg font-instrument-semibold">
                        {option.label}
                      </Text>
                      <Text selectable={false} className="text-gray-300 font-instrument mt-1">
                        {option.description}
                      </Text>
                    </View>
                    <View
                      className={`mt-1 h-5 w-5 rounded-full border ${
                        selected ? 'border-brand-orange bg-brand-orange' : 'border-[#4A4A4A]'
                      }`}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>

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
          <Text
            selectable={false}
            className="text-xs font-instrument-medium uppercase tracking-[2px] text-brand-orange mb-3"
          >
            Account setup
          </Text>
          <Text selectable={false} className="text-3xl font-instrument-semibold text-white mb-2">
            Create your login
          </Text>
          <Text selectable={false} className="text-gray-300 font-instrument">
            Set up your Furnace owner account, then continue to your selected payment route.
          </Text>
        </View>

        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          <Text selectable={false} className="text-white text-lg font-instrument-semibold mb-4">
            Payment summary
          </Text>
          {renderPriceSummary()}
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
            onPress={() => setStep('payment')}
            disabled={submitting}
          >
            Back
          </Button>
          <Button
            className="flex-1"
            onPress={handleContinueToCheckout}
            disabled={submitting || quoteLoading || !quote}
          >
            {submitting
              ? mode === 'preview'
                ? 'Opening preview...'
                : 'Starting payment...'
              : mode === 'preview'
                ? `Preview ${activeRouteOption.label.toLowerCase()} checkout`
                : activeRouteOption.checkoutButtonLabel}
          </Button>
        </View>
      </View>
    );
  };

  return (
    <View className="min-h-full flex-1 bg-[#121212]" style={INVITE_FLOW_NON_SELECTABLE_STYLE}>
      <View className="absolute inset-0">
        <HeroHeatShimmer
          intensity="low"
          speed="slow"
          tint="ember"
          className="absolute inset-0"
          midground={<EmberParticlesLite density="low" maxOpacity={0.06} count={6} />}
        />
      </View>
      <KeyboardAvoidingView
        className="min-h-full flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 16,
            paddingTop: embedded ? 16 : insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="mx-auto w-full max-w-3xl items-center">
            <View
              className={`w-full items-center ${clientLogoUrl ? 'max-w-3xl' : 'max-w-[220px]'}`}
            >
              <PlatformInviteLogoBar
                clientLogoUrl={clientLogoUrl}
                clientLogoScale={clientLogoScale}
                clientLogoOffsetX={clientLogoOffsetX}
              />
            </View>
            {mode === 'preview' ? (
              <Text
                selectable={false}
                className="mt-3 text-xs font-instrument-medium uppercase tracking-[2px] text-gray-500"
              >
                Admin preview
              </Text>
            ) : null}
            <View style={{ height: 16 }} />
            <View
              className={`w-full overflow-hidden ${
                isProposalStep
                  ? 'bg-transparent p-0'
                  : 'rounded-2xl border border-[#2A2A2A] bg-[#121212] p-6 md:p-8'
              }`}
            >
              {renderStepBody()}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
