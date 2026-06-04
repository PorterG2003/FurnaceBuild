import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInviteRecurringCouponParams,
  buildStripeCouponName,
  buildUpgradeDeltaCouponParams,
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
