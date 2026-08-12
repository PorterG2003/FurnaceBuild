import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInviteRecurringCouponParams,
  buildStripeCouponName,
  buildUpgradeDeltaCouponParams,
  resolveInviteRecurringCouponAmountCents,
} from './couponParams.js';

test('buildStripeCouponName keeps long uuid references within Stripe limits', () => {
  const name = buildStripeCouponName(
    'Platform invite first recurring invoice adjustment',
    'd064dcc6-5a9e-4fc2-922c-bcd7fc3d1ee5',
  );

  assert.ok(name.length <= 40);
  assert.equal(name, 'Platform invite first recurring d064dcc6');
});

test('buildInviteRecurringCouponParams uses a Stripe-safe display name and preserves full metadata', () => {
  const params = buildInviteRecurringCouponParams({
    amountOff: 6_639,
    currency: 'usd',
    invitationId: 'd064dcc6-5a9e-4fc2-922c-bcd7fc3d1ee5',
    firstRecurringInvoiceAmountCents: 199_191,
    overlapCreditCents: 6_452,
    paymentRoute: 'card',
  });

  assert.ok(typeof params.name === 'string');
  assert.ok((params.name ?? '').length <= 40);
  assert.equal(params.name, 'Platform invite recurring d064dcc6');
  assert.deepEqual(params.metadata, {
    invitationId: 'd064dcc6-5a9e-4fc2-922c-bcd7fc3d1ee5',
    firstRecurringInvoiceAmountCents: '199191',
    overlapCreditCents: '6452',
    paymentRoute: 'card',
  });
});

test('resolveInviteRecurringCouponAmountCents discounts the credited difference for second-month invites', () => {
  const amount = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: 86_436,
    ongoingMonthlyTotalCents: 185_250,
    firstRecurringInvoiceTotalCents: 98_814,
  });

  assert.equal(amount, 86_436);
});

test('resolveInviteRecurringCouponAmountCents skips the coupon for first-month invites', () => {
  const amount = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: 0,
    ongoingMonthlyTotalCents: 185_250,
    firstRecurringInvoiceTotalCents: 185_250,
  });

  assert.equal(amount, 0);
});

test('resolveInviteRecurringCouponAmountCents skips the coupon when the client accepts on the 1st', () => {
  const amount = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: 0,
    ongoingMonthlyTotalCents: 180_000,
    firstRecurringInvoiceTotalCents: 180_000,
  });

  assert.equal(amount, 0);
});

test('resolveInviteRecurringCouponAmountCents falls back to the derived difference when metadata is missing', () => {
  const amount = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: 0,
    ongoingMonthlyTotalCents: 185_250,
    firstRecurringInvoiceTotalCents: 98_814,
  });

  assert.equal(amount, 86_436);
});

test('resolveInviteRecurringCouponAmountCents never returns a negative discount', () => {
  const amount = resolveInviteRecurringCouponAmountCents({
    metadataCouponAmountCents: 0,
    ongoingMonthlyTotalCents: 100_000,
    firstRecurringInvoiceTotalCents: 120_000,
  });

  assert.equal(amount, 0);
});

test('buildUpgradeDeltaCouponParams uses a Stripe-safe display name and preserves full metadata', () => {
  const params = buildUpgradeDeltaCouponParams({
    amountOff: 9_200,
    currency: 'usd',
    accountId: '7ec3a1b7-4c18-47d2-a3b9-57e1ab07df72',
    invoiceId: 'in_test_123',
  });

  assert.ok(typeof params.name === 'string');
  assert.ok((params.name ?? '').length <= 40);
  assert.equal(params.name, 'Platform upgrade delta 7ec3a1b7');
  assert.deepEqual(params.metadata, {
    accountId: '7ec3a1b7-4c18-47d2-a3b9-57e1ab07df72',
    invoiceId: 'in_test_123',
  });
});
