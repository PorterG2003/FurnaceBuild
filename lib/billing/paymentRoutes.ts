export type PlatformPaymentRoute = 'card' | 'ach';

export interface PlatformPaymentRouteOption {
  id: PlatformPaymentRoute;
  label: string;
  description: string;
  checkoutButtonLabel: string;
}

export interface PlatformPaymentFeeConfig {
  percentageFeeBps: number;
  flatFeeCents: number;
  maxFeeCents?: number | null;
}

export interface PlatformPaymentQuoteInput {
  monthlyRetainerCents: number;
  /** Amount actually charged today. Defaults to the full retainer when not prorated. */
  dueTodaySubtotalCents?: number;
  paymentRoute: PlatformPaymentRoute;
  routeConfig: PlatformPaymentFeeConfig;
}

export interface PlatformPaymentQuote {
  paymentRoute: PlatformPaymentRoute;
  baseAmountCents: number;
  subtotalCents: number;
  routeFeeCents: number;
  totalDueTodayCents: number;
}

export interface PlatformRouteChargeBreakdown {
  paymentRoute: PlatformPaymentRoute;
  subtotalCents: number;
  routeFeeCents: number;
  totalCents: number;
}

export interface PlatformRecurringInvoiceQuote {
  paymentRoute: PlatformPaymentRoute;
  firstRecurringSubtotalCents: number;
  firstRecurringRouteFeeCents: number;
  firstRecurringTotalCents: number;
  ongoingMonthlySubtotalCents: number;
  ongoingMonthlyRouteFeeCents: number;
  ongoingMonthlyTotalCents: number;
  firstRecurringTotalDiscountCents: number;
}

const DEFAULT_CARD_FEE_BPS = 290;
const DEFAULT_CARD_FLAT_FEE_CENTS = 30;
const DEFAULT_ACH_FEE_BPS = 0;
const DEFAULT_ACH_FLAT_FEE_CENTS = 0;
const DEFAULT_ACH_MAX_FEE_CENTS = 0;

export const PLATFORM_PAYMENT_ROUTE_OPTIONS: readonly PlatformPaymentRouteOption[] = [
  {
    id: 'card',
    label: 'Card',
    description: 'Pay instantly with a credit or debit card.',
    checkoutButtonLabel: 'Pay',
  },
  {
    id: 'ach',
    label: 'ACH',
    description: 'Pay from a US bank account.',
    checkoutButtonLabel: 'Pay',
  },
] as const;

export function isPlatformPaymentRoute(value: unknown): value is PlatformPaymentRoute {
  return value === 'card' || value === 'ach';
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getServerPlatformPaymentFeeConfig(
  env: Record<string, string | undefined> = process.env,
): Record<PlatformPaymentRoute, PlatformPaymentFeeConfig> {
  return {
    card: {
      percentageFeeBps: parseIntegerEnv(env.STRIPE_PLATFORM_CARD_FEE_BPS, DEFAULT_CARD_FEE_BPS),
      flatFeeCents: parseIntegerEnv(
        env.STRIPE_PLATFORM_CARD_FEE_FLAT_CENTS,
        DEFAULT_CARD_FLAT_FEE_CENTS,
      ),
      maxFeeCents: null,
    },
    ach: {
      percentageFeeBps: DEFAULT_ACH_FEE_BPS,
      flatFeeCents: DEFAULT_ACH_FLAT_FEE_CENTS,
      maxFeeCents: DEFAULT_ACH_MAX_FEE_CENTS,
    },
  };
}

export function calculatePlatformRouteFeeCents(
  subtotalCents: number,
  config: PlatformPaymentFeeConfig,
): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  const rawFee =
    Math.round((subtotalCents * Math.max(config.percentageFeeBps, 0)) / 10_000) +
    Math.max(config.flatFeeCents, 0);
  if (typeof config.maxFeeCents === 'number' && Number.isFinite(config.maxFeeCents)) {
    return Math.max(0, Math.min(rawFee, config.maxFeeCents));
  }
  return Math.max(0, rawFee);
}

export function buildPlatformRouteChargeBreakdown(input: {
  subtotalCents: number;
  paymentRoute: PlatformPaymentRoute;
  routeConfig: PlatformPaymentFeeConfig;
}): PlatformRouteChargeBreakdown {
  const subtotalCents = Math.max(input.subtotalCents, 0);
  const routeFeeCents = calculatePlatformRouteFeeCents(subtotalCents, input.routeConfig);
  return {
    paymentRoute: input.paymentRoute,
    subtotalCents,
    routeFeeCents,
    totalCents: subtotalCents + routeFeeCents,
  };
}

export function buildPlatformPaymentQuote(
  input: PlatformPaymentQuoteInput,
): PlatformPaymentQuote {
  if (!Number.isFinite(input.monthlyRetainerCents) || input.monthlyRetainerCents < 0) {
    throw new Error('monthlyRetainerCents must be zero or greater');
  }

  const dueTodaySubtotalCents = input.dueTodaySubtotalCents ?? input.monthlyRetainerCents;
  if (!Number.isFinite(dueTodaySubtotalCents) || dueTodaySubtotalCents < 0) {
    throw new Error('dueTodaySubtotalCents must be zero or greater');
  }

  const charge = buildPlatformRouteChargeBreakdown({
    subtotalCents: dueTodaySubtotalCents,
    paymentRoute: input.paymentRoute,
    routeConfig: input.routeConfig,
  });

  return {
    paymentRoute: input.paymentRoute,
    baseAmountCents: input.monthlyRetainerCents,
    subtotalCents: charge.subtotalCents,
    routeFeeCents: charge.routeFeeCents,
    totalDueTodayCents: charge.totalCents,
  };
}

export function buildPlatformRecurringInvoiceQuote(input: {
  monthlyRetainerCents: number;
  firstRecurringSubtotalCents: number;
  paymentRoute: PlatformPaymentRoute;
  routeConfig: PlatformPaymentFeeConfig;
}): PlatformRecurringInvoiceQuote {
  if (!Number.isFinite(input.monthlyRetainerCents) || input.monthlyRetainerCents < 0) {
    throw new Error('monthlyRetainerCents must be zero or greater');
  }
  if (!Number.isFinite(input.firstRecurringSubtotalCents) || input.firstRecurringSubtotalCents < 0) {
    throw new Error('firstRecurringSubtotalCents must be zero or greater');
  }

  const firstRecurringCharge = buildPlatformRouteChargeBreakdown({
    subtotalCents: input.firstRecurringSubtotalCents,
    paymentRoute: input.paymentRoute,
    routeConfig: input.routeConfig,
  });
  const ongoingMonthlyCharge = buildPlatformRouteChargeBreakdown({
    subtotalCents: input.monthlyRetainerCents,
    paymentRoute: input.paymentRoute,
    routeConfig: input.routeConfig,
  });

  return {
    paymentRoute: input.paymentRoute,
    firstRecurringSubtotalCents: firstRecurringCharge.subtotalCents,
    firstRecurringRouteFeeCents: firstRecurringCharge.routeFeeCents,
    firstRecurringTotalCents: firstRecurringCharge.totalCents,
    ongoingMonthlySubtotalCents: ongoingMonthlyCharge.subtotalCents,
    ongoingMonthlyRouteFeeCents: ongoingMonthlyCharge.routeFeeCents,
    ongoingMonthlyTotalCents: ongoingMonthlyCharge.totalCents,
    firstRecurringTotalDiscountCents: Math.max(
      ongoingMonthlyCharge.totalCents - firstRecurringCharge.totalCents,
      0,
    ),
  };
}

export function getPlatformPaymentRouteOption(
  paymentRoute: PlatformPaymentRoute,
): PlatformPaymentRouteOption {
  return (
    PLATFORM_PAYMENT_ROUTE_OPTIONS.find((option) => option.id === paymentRoute) ??
    PLATFORM_PAYMENT_ROUTE_OPTIONS[0]
  );
}
