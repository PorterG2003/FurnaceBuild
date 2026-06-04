import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBillingAnchorPlan, getNextMonthlyAnchorDate } from './proration';

test('getNextMonthlyAnchorDate returns the first of the next month in MST', () => {
  const anchor = getNextMonthlyAnchorDate(new Date('2026-05-15T18:00:00.000Z'));
  assert.equal(anchor.toISOString(), '2026-06-01T07:00:00.000Z');
});

test('buildBillingAnchorPlan keeps the first recurring invoice full when no anchor-month overlap exists', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-05-01T10:00:00.000Z'), 180_000);
  assert.equal(plan.anchorDateIso, '2026-06-01T07:00:00.000Z');
  assert.equal(plan.firstRecurringAmountDueCents, 180_000);
  assert.equal(plan.overlapCreditCents, 0);
});

test('buildBillingAnchorPlan credits the overlap and charges the remaining anchor-month amount', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-05-15T10:00:00.000Z'), 180_000);
  assert.equal(plan.anchorDateIso, '2026-06-01T07:00:00.000Z');
  assert.equal(plan.firstRecurringAmountDueCents, 96_000);
  assert.equal(plan.overlapCreditCents, 84_000);
});

test('buildBillingAnchorPlan caps overlap credit to the full anchor month', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-01-31T10:00:00.000Z'), 100_000);
  assert.equal(plan.anchorDateIso, '2026-02-01T07:00:00.000Z');
  assert.equal(plan.firstRecurringAmountDueCents, 0);
  assert.equal(plan.overlapCreditCents, 100_000);
});

test('buildBillingAnchorPlan uses MST calendar days instead of UTC rollover', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-06-02T04:30:00.000Z'), 200_000);
  assert.equal(plan.anchorDateIso, '2026-07-01T07:00:00.000Z');
  assert.equal(plan.firstRecurringAmountDueCents, 200_000);
  assert.equal(plan.overlapCreditCents, 0);
});

test('buildBillingAnchorPlan allows a zero retainer', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-05-15T10:00:00.000Z'), 0);
  assert.equal(plan.anchorDateIso, '2026-06-01T07:00:00.000Z');
  assert.equal(plan.firstRecurringAmountDueCents, 0);
  assert.equal(plan.overlapCreditCents, 0);
});
