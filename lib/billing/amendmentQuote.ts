import {
  buildPlatformRecurringInvoiceQuote,
  buildPlatformRouteChargeBreakdown,
  type PlatformPaymentFeeConfig,
  type PlatformPaymentRoute,
} from './paymentRoutes';
import { buildUpgradeBillingPlan, type UpgradeBillingPlan } from './upgradeProration';

export interface AmendmentUpgradeQuote {
  paymentRoute: PlatformPaymentRoute;
  deltaCents: number;
  dueTodaySubtotalCents: number;
  dueTodayRouteFeeCents: number;
  dueTodayTotalCents: number;
  anchorDateIso: string;
  elapsedDays: number;
  daysInMonth: number;
  nextInvoiceBaseCreditCents: number;
  nextInvoiceBaseAmountCents: number;
  nextInvoiceCreditCents: number;
  nextInvoiceRouteFeeCents: number;
  nextInvoiceAmountCents: number;
  ongoingMonthlyRouteFeeCents: number;
  ongoingMonthlyTotalCents: number;
}

export function buildAmendmentUpgradeQuote(input: {
  effectiveAt: Date;
  oldMonthlyRetainerCents: number;
  newMonthlyRetainerCents: number;
  paymentRoute: PlatformPaymentRoute;
  routeConfig: PlatformPaymentFeeConfig;
}): AmendmentUpgradeQuote {
  const basePlan: UpgradeBillingPlan = buildUpgradeBillingPlan(
    input.effectiveAt,
    input.oldMonthlyRetainerCents,
    input.newMonthlyRetainerCents,
  );

  const dueTodayCharge = buildPlatformRouteChargeBreakdown({
    subtotalCents: basePlan.dueTodaySubtotalCents,
    paymentRoute: input.paymentRoute,
    routeConfig: input.routeConfig,
  });
  const recurringQuote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: input.newMonthlyRetainerCents,
    firstRecurringSubtotalCents: basePlan.nextInvoiceBaseAmountCents,
    paymentRoute: input.paymentRoute,
    routeConfig: input.routeConfig,
  });

  return {
    paymentRoute: input.paymentRoute,
    deltaCents: basePlan.deltaCents,
    dueTodaySubtotalCents: dueTodayCharge.subtotalCents,
    dueTodayRouteFeeCents: dueTodayCharge.routeFeeCents,
    dueTodayTotalCents: dueTodayCharge.totalCents,
    anchorDateIso: basePlan.anchorDateIso,
    elapsedDays: basePlan.elapsedDays,
    daysInMonth: basePlan.daysInMonth,
    nextInvoiceBaseCreditCents: basePlan.nextInvoiceBaseCreditCents,
    nextInvoiceBaseAmountCents: basePlan.nextInvoiceBaseAmountCents,
    nextInvoiceCreditCents: recurringQuote.firstRecurringTotalDiscountCents,
    nextInvoiceRouteFeeCents: recurringQuote.firstRecurringRouteFeeCents,
    nextInvoiceAmountCents: recurringQuote.firstRecurringTotalCents,
    ongoingMonthlyRouteFeeCents: recurringQuote.ongoingMonthlyRouteFeeCents,
    ongoingMonthlyTotalCents: recurringQuote.ongoingMonthlyTotalCents,
  };
}
