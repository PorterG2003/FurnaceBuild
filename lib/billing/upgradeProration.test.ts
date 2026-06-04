import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUpgradeBillingPlan } from './upgradeProration';

test('buildUpgradeBillingPlan charges full delta upfront', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2026-05-15T12:00:00.000Z'),
    300_000,
    500_000,
  );
  assert.equal(plan.deltaCents, 200_000);
  assert.equal(plan.dueTodaySubtotalCents, 200_000);
});

test('buildUpgradeBillingPlan uses MST elapsed days for the next invoice credit', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2026-05-15T12:00:00.000Z'),
    300_000,
    500_000,
  );
  assert.equal(plan.anchorDateIso, '2026-06-01T07:00:00.000Z');
  assert.equal(plan.elapsedDays, 14);
  assert.equal(plan.daysInMonth, 31);
  assert.equal(plan.nextInvoiceBaseCreditCents, 90_323);
  assert.equal(plan.nextInvoiceBaseAmountCents, 409_677);
});

test('buildUpgradeBillingPlan keeps the next invoice at the full new retainer when no MST days elapsed', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2026-05-01T12:00:00.000Z'),
    300_000,
    500_000,
  );
  assert.equal(plan.elapsedDays, 0);
  assert.equal(plan.nextInvoiceBaseCreditCents, 0);
  assert.equal(plan.nextInvoiceBaseAmountCents, 500_000);
});

test('buildUpgradeBillingPlan handles leap-year February', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2028-02-20T12:00:00.000Z'),
    400_000,
    600_000,
  );
  assert.equal(plan.deltaCents, 200_000);
  assert.equal(plan.elapsedDays, 19);
  assert.equal(plan.daysInMonth, 29);
  assert.equal(plan.nextInvoiceBaseCreditCents, 131_034);
  assert.equal(plan.nextInvoiceBaseAmountCents, 468_966);
});

test('buildUpgradeBillingPlan uses MST instead of UTC near midnight boundaries', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2026-06-01T01:30:00.000Z'),
    300_000,
    500_000,
  );
  assert.equal(plan.anchorDateIso, '2026-06-01T07:00:00.000Z');
  assert.equal(plan.elapsedDays, 30);
  assert.equal(plan.daysInMonth, 31);
  assert.equal(plan.nextInvoiceBaseCreditCents, 193_548);
  assert.equal(plan.nextInvoiceBaseAmountCents, 306_452);
});

test('buildUpgradeBillingPlan supports upgrades from a free retainer', () => {
  const plan = buildUpgradeBillingPlan(
    new Date('2026-05-15T12:00:00.000Z'),
    0,
    500_000,
  );
  assert.equal(plan.deltaCents, 500_000);
  assert.equal(plan.dueTodaySubtotalCents, 500_000);
  assert.equal(plan.nextInvoiceBaseCreditCents, 225_806);
  assert.equal(plan.nextInvoiceBaseAmountCents, 274_194);
});
