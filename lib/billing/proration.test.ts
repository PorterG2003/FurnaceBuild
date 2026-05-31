import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBillingAnchorPlan, getNextMonthlyAnchorDate } from './proration';

test('getNextMonthlyAnchorDate returns the first of the next UTC month', () => {
  const anchor = getNextMonthlyAnchorDate(new Date('2026-05-15T18:00:00.000Z'));
  assert.equal(anchor.toISOString(), '2026-06-01T12:00:00.000Z');
});

test('buildBillingAnchorPlan keeps the first recurring invoice full for first-of-month signups', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-05-01T10:00:00.000Z'), 180_000);
  assert.equal(plan.anchorDateIso, '2026-06-01T12:00:00.000Z');
  assert.equal(plan.firstRecurringInvoiceAmountCents, 180_000);
  assert.equal(plan.firstRecurringCreditCents, 0);
});

test('buildBillingAnchorPlan prorates the next invoice for mid-month starts', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-05-15T10:00:00.000Z'), 180_000);
  assert.equal(plan.anchorDateIso, '2026-06-01T12:00:00.000Z');
  assert.equal(plan.firstRecurringInvoiceAmountCents, 84_000);
  assert.equal(plan.firstRecurringCreditCents, 96_000);
});

test('buildBillingAnchorPlan caps the carried days for shorter next months', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-01-31T10:00:00.000Z'), 100_000);
  assert.equal(plan.anchorDateIso, '2026-02-01T12:00:00.000Z');
  assert.equal(plan.firstRecurringInvoiceAmountCents, 100_000);
  assert.equal(plan.firstRecurringCreditCents, 0);
});
