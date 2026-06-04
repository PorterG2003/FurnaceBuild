import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { PlatformAcceptExperience } from '@/components/platform/contract/PlatformAcceptExperience';
import {
  PlatformPaymentBreakdown,
  type PlatformPaymentBreakdownRow,
  type PlatformPaymentBreakdownSection,
} from '@/components/platform/contract/PlatformPaymentBreakdown';
import { PlatformPaymentRouteSelector } from '@/components/platform/contract/PlatformPaymentRouteSelector';
import type { AmendmentUpgradeQuote } from '@/lib/billing/amendmentQuote';
import {
  getPlatformPaymentRouteOption,
  type PlatformPaymentRoute,
} from '@/lib/billing/paymentRoutes';
import type { PlatformAccountAmendmentInfo } from '@/lib/supabase/services/platform';

export function PlatformAmendmentUpgradePaymentStep({
  info,
  quote,
  quoteLoading,
  quoteError,
  saving,
  paymentPhaseState,
  billingStatus,
  paymentRoute,
  savedPaymentRoute,
  onSelectPaymentRoute,
  onConfirm,
  onBack,
}: {
  info: PlatformAccountAmendmentInfo;
  quote: AmendmentUpgradeQuote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  saving: boolean;
  paymentPhaseState: 'initial' | 'resume' | 'recovery';
  billingStatus?: string | null;
  paymentRoute: PlatformPaymentRoute;
  savedPaymentRoute: PlatformPaymentRoute;
  onSelectPaymentRoute: (paymentRoute: PlatformPaymentRoute) => void;
  onConfirm: () => void;
  onBack?: () => void;
}) {
  const currentRetainerCents = info.current_monthly_retainer_cents ?? 0;
  const proposedRetainerCents = info.proposed_monthly_retainer_cents ?? 0;
  const hasValidUpgrade = currentRetainerCents > 0 && proposedRetainerCents > currentRetainerCents;
  const isRecovery = paymentPhaseState === 'recovery' || billingStatus === 'payment_required';
  const isResume = paymentPhaseState === 'resume';
  const requiresDefaultUpdate = paymentRoute !== savedPaymentRoute;
  const selectedRouteOption = getPlatformPaymentRouteOption(paymentRoute);
  const savedRouteOption = getPlatformPaymentRouteOption(savedPaymentRoute);

  const anchorLabel = useMemo(() => {
    if (!quote?.anchorDateIso) return 'your next invoice';
    return new Date(quote.anchorDateIso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [quote?.anchorDateIso]);

  const formatCurrency = (cents?: number | null) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format((cents ?? 0) / 100);

  const title = isRecovery ? 'Payment still required' : 'Confirm payment';
  const introCopy = isRecovery
    ? `This agreement update for ${info.account_name} is still waiting for payment. Choose how you want to pay, review the updated totals, and confirm payment to finish applying it.`
    : isResume
      ? `This agreement has already been reviewed for ${info.account_name}. Choose how you want to pay, review the updated totals, and confirm payment to apply the change.`
      : `You have reviewed the updated agreement for ${info.account_name}. Choose how you want to pay, review the updated totals, and confirm payment to apply the change.`;
  const outcomeCopy =
    paymentRoute === 'ach'
      ? 'ACH upgrades provision immediately after you confirm, but the debit can settle later.'
      : 'Card payments charge immediately when you confirm this upgrade.';
  const recoveryMessage =
    billingStatus === 'payment_required'
      ? 'Billing for this workspace needs attention. Review the updated totals and confirm payment to clear the outstanding upgrade.'
      : 'A previous payment attempt did not complete. Review the updated totals and confirm payment to finish applying this agreement.';
  const primaryButtonLabel = requiresDefaultUpdate
    ? `Update default to ${selectedRouteOption.label}`
    : 'Confirm and pay';

  const dueTodayRows: PlatformPaymentBreakdownRow[] = quote
    ? [
        {
          label: 'Upgrade subtotal',
          value: formatCurrency(quote.dueTodaySubtotalCents),
        },
        ...(quote.dueTodayRouteFeeCents > 0
          ? [
              {
                label: `${paymentRoute === 'card' ? 'Card' : 'ACH'} processing fee`,
                value: formatCurrency(quote.dueTodayRouteFeeCents),
              },
            ]
          : []),
        {
          label: 'Total due today',
          value: formatCurrency(quote.dueTodayTotalCents),
          emphasize: true,
        },
      ]
    : [];

  const futureRows: PlatformPaymentBreakdownRow[] = quote
    ? [
        {
          label: `Current monthly retainer`,
          value: formatCurrency(currentRetainerCents),
        },
        {
          label: `New monthly retainer`,
          value: formatCurrency(proposedRetainerCents),
          emphasize: true,
        },
        ...(quote.ongoingMonthlyRouteFeeCents > 0
          ? [
              {
                label: `${paymentRoute === 'card' ? 'Card' : 'ACH'} recurring fee`,
                value: formatCurrency(quote.ongoingMonthlyRouteFeeCents),
              },
            ]
          : []),
        {
          label: `Amount due on ${anchorLabel}`,
          value: formatCurrency(quote.nextInvoiceAmountCents),
        },
        ...(quote.nextInvoiceCreditCents > 0
          ? [
              {
                label: `Included overlap credit on ${anchorLabel}`,
                value: `-${formatCurrency(quote.nextInvoiceCreditCents)}`,
              },
            ]
          : []),
      ]
    : [];

  const priceSections: PlatformPaymentBreakdownSection[] = quote
    ? [
        {
          title: 'Due today',
          rows: dueTodayRows,
        },
        {
          title: 'Future invoices',
          rows: futureRows,
        },
      ]
    : [];

  return (
    <PlatformAcceptExperience contentMode="framed">
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-brand-orange text-xs font-instrument-semibold uppercase tracking-[2px]">
            Step 2 of 2
          </Text>
          <Text className="text-white font-instrument-semibold text-3xl">{title}</Text>
          <Text className="text-gray-300 font-instrument">
            {introCopy}
          </Text>
        </View>

        {isRecovery ? (
          <Alert
            variant="warning"
            message={recoveryMessage}
          />
        ) : null}

        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 gap-3">
          <Text className="text-xs font-instrument-medium uppercase tracking-[2px] text-gray-500">
            Agreement summary
          </Text>
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-gray-300 font-instrument">Current monthly retainer</Text>
            <Text className="text-white font-instrument">{formatCurrency(currentRetainerCents)}</Text>
          </View>
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-gray-300 font-instrument">New monthly retainer</Text>
            <Text className="text-white font-instrument font-instrument-semibold">
              {formatCurrency(proposedRetainerCents)}
            </Text>
          </View>
          <Text className="text-gray-400 font-instrument text-sm">
            The updated agreement only becomes active after this payment step is completed.
          </Text>
        </View>

        <View className="gap-3">
          <Text className="text-xs font-instrument-medium uppercase tracking-[2px] text-gray-500">
            Choose payment method
          </Text>
          <Text className="text-gray-400 font-instrument text-sm">
            This choice affects today&apos;s charge, future recurring invoices, and any future
            amendment retries.
          </Text>
          <PlatformPaymentRouteSelector
            selectedRoute={paymentRoute}
            onSelect={onSelectPaymentRoute}
            disabled={saving || quoteLoading}
            defaultRoute={savedPaymentRoute}
          />
          {requiresDefaultUpdate ? (
            <Alert
              variant="info"
              message={`You are previewing ${selectedRouteOption.label} pricing, but your current default payment method is ${savedRouteOption.label}. When you continue, Furnace will ask you to update the default payment method before charging this route.`}
            />
          ) : (
            <Text className="text-gray-400 font-instrument text-sm">
              You are reviewing pricing for your current default payment method. Continuing will
              charge the saved {savedRouteOption.label} method on file.
            </Text>
          )}
          <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4 gap-2">
            <Text className="text-white font-instrument-medium">
              {paymentRoute === 'ach' ? 'ACH details' : 'Card details'}
            </Text>
            <Text className="text-gray-300 font-instrument text-sm">{outcomeCopy}</Text>
            {paymentRoute === 'ach' ? (
              <Text className="text-gray-400 font-instrument text-sm">
                If an ACH debit later fails, workspace access will be blocked until billing is
                resolved.
              </Text>
            ) : null}
          </View>
        </View>

        {!hasValidUpgrade ? (
          <Alert
            variant="error"
            message="We could not calculate the upgrade payment for this agreement. Please go back and try again."
          />
        ) : quoteLoading ? (
          <Alert
            variant="info"
            message="Refreshing the payment summary for the selected billing method..."
          />
        ) : quoteError ? (
          <Alert
            variant="error"
            message={quoteError}
          />
        ) : !quote ? (
          <Alert
            variant="error"
            message="We could not load the billing preview for this agreement. Please try again."
          />
        ) : (
          <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
            <PlatformPaymentBreakdown sections={priceSections} />
          </View>
        )}

        <View className="flex-row flex-wrap gap-3">
          {onBack ? (
            <Button variant="outline" className="flex-1" onPress={onBack} disabled={saving}>
              Back to agreement
            </Button>
          ) : null}
          <Button
            className="flex-1"
            disabled={saving || !hasValidUpgrade || !quote || quoteLoading || !!quoteError}
            onPress={onConfirm}
          >
            {saving
              ? requiresDefaultUpdate
                ? 'Updating payment method...'
                : 'Processing payment...'
              : primaryButtonLabel}
          </Button>
        </View>
      </View>
    </PlatformAcceptExperience>
  );
}
