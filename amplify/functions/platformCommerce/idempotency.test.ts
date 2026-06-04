import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountUpgradeIdempotencyKey } from './idempotency';

test('buildAccountUpgradeIdempotencyKey changes when payment route changes', () => {
  const achKey = buildAccountUpgradeIdempotencyKey({
    accountId: 'acct_123',
    amendmentId: 'amd_123',
    newMonthlyRetainerCents: 4_000_000,
    paymentRoute: 'ach',
    dueTodayTotalCents: 1_000_000,
    ongoingMonthlyTotalCents: 4_000_000,
  });

  const cardKey = buildAccountUpgradeIdempotencyKey({
    accountId: 'acct_123',
    amendmentId: 'amd_123',
    newMonthlyRetainerCents: 4_000_000,
    paymentRoute: 'card',
    dueTodayTotalCents: 1_029_030,
    ongoingMonthlyTotalCents: 4_116_030,
  });

  assert.notEqual(achKey, cardKey);
});

test('buildAccountUpgradeIdempotencyKey stays stable for identical upgrade parameters', () => {
  const firstKey = buildAccountUpgradeIdempotencyKey({
    accountId: 'acct_123',
    amendmentId: 'amd_123',
    newMonthlyRetainerCents: 4_000_000,
    paymentRoute: 'card',
    dueTodayTotalCents: 1_029_030,
    ongoingMonthlyTotalCents: 4_116_030,
  });

  const secondKey = buildAccountUpgradeIdempotencyKey({
    accountId: 'acct_123',
    amendmentId: 'amd_123',
    newMonthlyRetainerCents: 4_000_000,
    paymentRoute: 'card',
    dueTodayTotalCents: 1_029_030,
    ongoingMonthlyTotalCents: 4_116_030,
  });

  assert.equal(firstKey, secondKey);
});
