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
  firstMonthDiscountCents?: number;
  paymentRoute: PlatformPaymentRoute;
  routeConfig: PlatformPaymentFeeConfig;
}

export interface PlatformPaymentQuote {
  paymentRoute: PlatformPaymentRoute;
  baseAmountCents: number;
  discountCents: number;
  subtotalCents: number;
  routeFeeCents: number;
  totalDueTodayCents: number;
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
    checkoutButtonLabel: 'Continue to card payment',
  },
  {
    id: 'ach',
    label: 'ACH',
    description: 'Pay from a US bank account.',
    checkoutButtonLabel: 'Continue to ACH payment',
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

export function buildPlatformPaymentQuote(
  input: PlatformPaymentQuoteInput,
): PlatformPaymentQuote {
  if (!Number.isFinite(input.monthlyRetainerCents) || input.monthlyRetainerCents <= 0) {
    throw new Error('monthlyRetainerCents must be positive');
  }

  const discountCents = Math.max(input.firstMonthDiscountCents ?? 0, 0);
  const subtotalCents = Math.max(input.monthlyRetainerCents - discountCents, 0);
  const routeFeeCents = calculatePlatformRouteFeeCents(subtotalCents, input.routeConfig);

  return {
    paymentRoute: input.paymentRoute,
    baseAmountCents: input.monthlyRetainerCents,
    discountCents,
    subtotalCents,
    routeFeeCents,
    totalDueTodayCents: subtotalCents + routeFeeCents,
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
