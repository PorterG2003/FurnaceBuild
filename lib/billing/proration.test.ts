import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBillingAnchorPlan,
  getNextMonthlyAnchorDate,
  isBillingAnchorPlanProrated,
  normalizePlatformInviteProrationMode,
} from './proration';

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

test('second_month charges a full month today and prorates the anchor invoice', () => {
  const plan = buildBillingAnchorPlan(
    new Date('2026-08-15T10:00:00.000Z'),
    180_000,
    'second_month',
  );

  assert.equal(plan.prorationMode, 'second_month');
  assert.equal(plan.anchorDateIso, '2026-09-01T07:00:00.000Z');
  assert.equal(plan.dueTodaySubtotalCents, 180_000);
  assert.equal(plan.overlapCreditCents, 84_000);
  assert.equal(plan.firstRecurringAmountDueCents, 96_000);
  assert.equal(isBillingAnchorPlanProrated(plan), false);
});

test('first_month prorates today by remaining signup-month days and keeps the anchor invoice full', () => {
  const plan = buildBillingAnchorPlan(
    new Date('2026-08-15T10:00:00.000Z'),
    180_000,
    'first_month',
  );

  assert.equal(plan.prorationMode, 'first_month');
  assert.equal(plan.anchorDateIso, '2026-09-01T07:00:00.000Z');
  assert.equal(plan.dueTodaySubtotalCents, 98_710);
  assert.equal(plan.dueTodayCoveredDays, 17);
  assert.equal(plan.dueTodayMonthDays, 31);
  assert.equal(plan.overlapCreditCents, 0);
  assert.equal(plan.firstRecurringAmountDueCents, 180_000);
  assert.equal(isBillingAnchorPlanProrated(plan), true);
});

test('first_month on the 1st MST charges a full month and reports no proration', () => {
  const plan = buildBillingAnchorPlan(
    new Date('2026-08-01T10:00:00.000Z'),
    180_000,
    'first_month',
  );

  assert.equal(plan.dueTodaySubtotalCents, 180_000);
  assert.equal(plan.dueTodayCoveredDays, 31);
  assert.equal(plan.dueTodayMonthDays, 31);
  assert.equal(plan.overlapCreditCents, 0);
  assert.equal(plan.firstRecurringAmountDueCents, 180_000);
  assert.equal(isBillingAnchorPlanProrated(plan), false);
});

test('first_month on the last day of the month charges a single day', () => {
  const plan = buildBillingAnchorPlan(
    new Date('2026-01-31T10:00:00.000Z'),
    180_000,
    'first_month',
  );

  assert.equal(plan.dueTodaySubtotalCents, 5_806);
  assert.equal(plan.dueTodayCoveredDays, 1);
  assert.equal(plan.dueTodayMonthDays, 31);
  assert.equal(plan.firstRecurringAmountDueCents, 180_000);
});

test('first_month clamps a sub-minimum prorated charge to the Stripe minimum', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-01-31T10:00:00.000Z'), 1_000, 'first_month');

  // round(1000 * 1 / 31) is 32 cents, below the $0.50 Stripe minimum.
  assert.equal(plan.dueTodaySubtotalCents, 50);
  assert.equal(plan.firstRecurringAmountDueCents, 1_000);
});

test('first_month keeps a zero retainer at zero instead of clamping it up', () => {
  const plan = buildBillingAnchorPlan(new Date('2026-01-31T10:00:00.000Z'), 0, 'first_month');

  assert.equal(plan.dueTodaySubtotalCents, 0);
  assert.equal(plan.firstRecurringAmountDueCents, 0);
  assert.equal(plan.overlapCreditCents, 0);
});

test('buildBillingAnchorPlan defaults to second_month so existing invites are unchanged', () => {
  const explicit = buildBillingAnchorPlan(
    new Date('2026-08-15T10:00:00.000Z'),
    180_000,
    'second_month',
  );
  const implicit = buildBillingAnchorPlan(new Date('2026-08-15T10:00:00.000Z'), 180_000);

  assert.deepEqual(implicit, explicit);
});

test('normalizePlatformInviteProrationMode falls back to second_month for unknown values', () => {
  assert.equal(normalizePlatformInviteProrationMode('first_month'), 'first_month');
  assert.equal(normalizePlatformInviteProrationMode('second_month'), 'second_month');
  assert.equal(normalizePlatformInviteProrationMode(null), 'second_month');
  assert.equal(normalizePlatformInviteProrationMode('nonsense'), 'second_month');
});
