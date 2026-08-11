import type { PlatformPaymentRoute } from '../../../lib/billing/paymentRoutes';

const STRIPE_COUPON_NAME_MAX_LENGTH = 40;

function compactStripeReference(reference: string) {
  const normalized = reference.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized.slice(0, 8) || 'ref';
}

export function buildStripeCouponName(label: string, reference: string) {
  const normalizedLabel = label.replace(/\s+/g, ' ').trim();
  const suffix = ` ${compactStripeReference(reference)}`;
  const labelLimit = Math.max(STRIPE_COUPON_NAME_MAX_LENGTH - suffix.length, 1);
  return `${normalizedLabel.slice(0, labelLimit)}${suffix}`.trim();
}

export function buildInviteRecurringCouponParams(args: {
  amountOff: number;
  currency: string;
  invitationId: string;
  firstRecurringInvoiceAmountCents: number;
  overlapCreditCents: number;
  paymentRoute: PlatformPaymentRoute;
}) {
  return {
    amount_off: args.amountOff,
    currency: args.currency,
    duration: 'once' as const,
    name: buildStripeCouponName('Platform invite recurring', args.invitationId),
    metadata: {
      invitationId: args.invitationId,
      firstRecurringInvoiceAmountCents: String(args.firstRecurringInvoiceAmountCents),
      overlapCreditCents: String(args.overlapCreditCents),
      paymentRoute: args.paymentRoute,
    },
  };
}

/**
 * Amount the once-off first-recurring coupon should discount. Zero means no coupon at all,
 * which is the normal case for first-month proration and for accepts on the 1st MST.
 */
export function resolveInviteRecurringCouponAmountCents(args: {
  metadataCouponAmountCents: number;
  ongoingMonthlyTotalCents: number;
  firstRecurringInvoiceTotalCents: number;
}) {
  if (args.metadataCouponAmountCents > 0) {
    return args.metadataCouponAmountCents;
  }
  return Math.max(args.ongoingMonthlyTotalCents - args.firstRecurringInvoiceTotalCents, 0);
}

export function buildUpgradeDeltaCouponParams(args: {
  amountOff: number;
  currency: string;
  accountId: string;
  invoiceId: string;
}) {
  return {
    amount_off: args.amountOff,
    currency: args.currency,
    duration: 'once' as const,
    name: buildStripeCouponName('Platform upgrade delta', args.accountId),
    metadata: {
      accountId: args.accountId,
      invoiceId: args.invoiceId,
    },
  };
}
