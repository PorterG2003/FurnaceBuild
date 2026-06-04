import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmendmentUpgradeQuote } from './amendmentQuote';

const cardRouteConfig = {
  percentageFeeBps: 290,
  flatFeeCents: 30,
  maxFeeCents: null,
} as const;

const achRouteConfig = {
  percentageFeeBps: 0,
  flatFeeCents: 0,
  maxFeeCents: 0,
} as const;

test('buildAmendmentUpgradeQuote includes route fees for card upgrades', () => {
  const quote = buildAmendmentUpgradeQuote({
    effectiveAt: new Date('2026-05-15T12:00:00.000Z'),
    oldMonthlyRetainerCents: 300_000,
    newMonthlyRetainerCents: 500_000,
    paymentRoute: 'card',
    routeConfig: cardRouteConfig,
  });

  assert.equal(quote.dueTodaySubtotalCents, 200_000);
  assert.equal(quote.dueTodayRouteFeeCents, 5_830);
  assert.equal(quote.dueTodayTotalCents, 205_830);
  assert.equal(quote.nextInvoiceBaseCreditCents, 90_323);
  assert.equal(quote.nextInvoiceAmountCents, 421_588);
  assert.equal(quote.nextInvoiceCreditCents, 92_942);
  assert.equal(quote.ongoingMonthlyRouteFeeCents, 14_530);
  assert.equal(quote.ongoingMonthlyTotalCents, 514_530);
});

test('buildAmendmentUpgradeQuote keeps ACH upgrade totals equal to the retainer math', () => {
  const quote = buildAmendmentUpgradeQuote({
    effectiveAt: new Date('2026-05-15T12:00:00.000Z'),
    oldMonthlyRetainerCents: 300_000,
    newMonthlyRetainerCents: 500_000,
    paymentRoute: 'ach',
    routeConfig: achRouteConfig,
  });

  assert.equal(quote.dueTodayTotalCents, 200_000);
  assert.equal(quote.nextInvoiceAmountCents, 409_677);
  assert.equal(quote.nextInvoiceCreditCents, 90_323);
  assert.equal(quote.ongoingMonthlyTotalCents, 500_000);
});
