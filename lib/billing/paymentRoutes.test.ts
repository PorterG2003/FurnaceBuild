import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlatformPaymentQuote,
  buildPlatformRecurringInvoiceQuote,
  buildPlatformRouteChargeBreakdown,
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
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'card',
    baseAmountCents: 180_000,
    subtotalCents: 180_000,
    routeFeeCents: 5_250,
    totalDueTodayCents: 185_250,
  });
});

test('buildPlatformPaymentQuote keeps ACH total equal to subtotal', () => {
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: 180_000,
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
    subtotalCents: 180_000,
    routeFeeCents: 0,
    totalDueTodayCents: 180_000,
  });
});

test('buildPlatformPaymentQuote allows a free retainer without fees', () => {
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: 0,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'card',
    baseAmountCents: 0,
    subtotalCents: 0,
    routeFeeCents: 0,
    totalDueTodayCents: 0,
  });
});

test('buildPlatformRouteChargeBreakdown returns total cents for card charges', () => {
  const charge = buildPlatformRouteChargeBreakdown({
    subtotalCents: 96_000,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(charge, {
    paymentRoute: 'card',
    subtotalCents: 96_000,
    routeFeeCents: 2_814,
    totalCents: 98_814,
  });
});

test('buildPlatformRecurringInvoiceQuote derives first and ongoing totals for card payments', () => {
  const quote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: 180_000,
    firstRecurringSubtotalCents: 96_000,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'card',
    firstRecurringSubtotalCents: 96_000,
    firstRecurringRouteFeeCents: 2_814,
    firstRecurringTotalCents: 98_814,
    ongoingMonthlySubtotalCents: 180_000,
    ongoingMonthlyRouteFeeCents: 5_250,
    ongoingMonthlyTotalCents: 185_250,
    firstRecurringTotalDiscountCents: 86_436,
  });
});

test('buildPlatformRecurringInvoiceQuote keeps ACH recurring totals equal to subtotals', () => {
  const quote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: 180_000,
    firstRecurringSubtotalCents: 96_000,
    paymentRoute: 'ach',
    routeConfig: {
      percentageFeeBps: 0,
      flatFeeCents: 0,
      maxFeeCents: 0,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'ach',
    firstRecurringSubtotalCents: 96_000,
    firstRecurringRouteFeeCents: 0,
    firstRecurringTotalCents: 96_000,
    ongoingMonthlySubtotalCents: 180_000,
    ongoingMonthlyRouteFeeCents: 0,
    ongoingMonthlyTotalCents: 180_000,
    firstRecurringTotalDiscountCents: 84_000,
  });
});

test('buildPlatformRecurringInvoiceQuote does not add a fee when the first recurring subtotal is zero', () => {
  const quote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: 180_000,
    firstRecurringSubtotalCents: 0,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.equal(quote.firstRecurringRouteFeeCents, 0);
  assert.equal(quote.firstRecurringTotalCents, 0);
  assert.equal(quote.firstRecurringTotalDiscountCents, quote.ongoingMonthlyTotalCents);
});

test('buildPlatformRecurringInvoiceQuote allows zero recurring retainers', () => {
  const quote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: 0,
    firstRecurringSubtotalCents: 0,
    paymentRoute: 'card',
    routeConfig: {
      percentageFeeBps: 290,
      flatFeeCents: 30,
    },
  });

  assert.deepEqual(quote, {
    paymentRoute: 'card',
    firstRecurringSubtotalCents: 0,
    firstRecurringRouteFeeCents: 0,
    firstRecurringTotalCents: 0,
    ongoingMonthlySubtotalCents: 0,
    ongoingMonthlyRouteFeeCents: 0,
    ongoingMonthlyTotalCents: 0,
    firstRecurringTotalDiscountCents: 0,
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
