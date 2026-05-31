import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlatformPaymentQuote,
  calculatePlatformRouteFeeCents,
  getServerPlatformPaymentFeeConfig,
} from './paymentRoutes';

test('calculatePlatformRouteFeeCents applies percentage and fixed card fee', () => {
  const fee = calculatePlatformRouteFeeCents(10_000, {
    percentageFeeBps: 290,
    flatFeeCents: 30,
  });
  assert.equal(fee, 320);
});

test('calculatePlatformRouteFeeCents returns zero for ACH customer fees', () => {
  const fee = calculatePlatformRouteFeeCents(100_000, {
    percentageFeeBps: 0,
    flatFeeCents: 0,
    maxFeeCents: 0,
  });
  assert.equal(fee, 0);
});

test('buildPlatformPaymentQuote derives subtotal, fee, and total due today', () => {
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: 180_000,
    firstMonthDiscountCents: 20_000,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'card',
    baseAmountCents: 180_000,
    discountCents: 20_000,
    subtotalCents: 160_000,
    routeFeeCents: 4_670,
    totalDueTodayCents: 164_670,
  });
});

test('buildPlatformPaymentQuote keeps ACH total equal to subtotal', () => {
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: 180_000,
    firstMonthDiscountCents: 20_000,
    paymentRoute: 'ach',
    routeConfig: {
      percentageFeeBps: 0,
      flatFeeCents: 0,
      maxFeeCents: 0,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'ach',
    baseAmountCents: 180_000,
    discountCents: 20_000,
    subtotalCents: 160_000,
    routeFeeCents: 0,
    totalDueTodayCents: 160_000,
  });
});

test('getServerPlatformPaymentFeeConfig reads environment overrides', () => {
  const config = getServerPlatformPaymentFeeConfig({
    STRIPE_PLATFORM_CARD_FEE_BPS: '350',
    STRIPE_PLATFORM_CARD_FEE_FLAT_CENTS: '45',
    STRIPE_PLATFORM_ACH_FEE_BPS: '120',
    STRIPE_PLATFORM_ACH_FEE_FLAT_CENTS: '10',
    STRIPE_PLATFORM_ACH_MAX_FEE_CENTS: '700',
  });

  assert.deepEqual(config, {
    card: {
      percentageFeeBps: 350,
      flatFeeCents: 45,
      maxFeeCents: null,
    },
    ach: {
      percentageFeeBps: 0,
      flatFeeCents: 0,
      maxFeeCents: 0,
    },
  });
});
