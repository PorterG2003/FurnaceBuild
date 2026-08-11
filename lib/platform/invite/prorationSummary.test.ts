import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInviteProrationSummary,
  formatMstDayLabel,
  getInviteProrationModeLabel,
} from './prorationSummary';

const formatAmount = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

test('formatMstDayLabel uses the MST calendar day rather than the local one', () => {
  assert.equal(formatMstDayLabel('2026-09-01T07:00:00.000Z'), 'Sep 1');
  assert.equal(formatMstDayLabel('2026-02-01T07:00:00.000Z'), 'Feb 1');
});

test('second_month summary quotes the full charge today and the credited anchor invoice', () => {
  const summary = buildInviteProrationSummary({
    monthlyRetainerCents: 180_000,
    prorationMode: 'second_month',
    formatAmount,
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  assert.equal(
    summary,
    'Charges $1,800.00 today, then $960.00 on Sep 1 and $1,800.00 monthly after that.',
  );
});

test('first_month summary quotes the prorated charge and its day coverage', () => {
  const summary = buildInviteProrationSummary({
    monthlyRetainerCents: 180_000,
    prorationMode: 'first_month',
    formatAmount,
    startedAt: new Date('2026-08-15T18:00:00.000Z'),
  });

  assert.equal(
    summary,
    'Charges $987.10 today (17 of 31 days), then $1,800.00 on Sep 1 and monthly after that.',
  );
});

test('summaries drop proration wording when the client accepts on the 1st MST', () => {
  for (const prorationMode of ['second_month', 'first_month'] as const) {
    const summary = buildInviteProrationSummary({
      monthlyRetainerCents: 180_000,
      prorationMode,
      formatAmount,
      startedAt: new Date('2026-08-01T18:00:00.000Z'),
    });

    assert.equal(
      summary,
      'Charges $1,800.00 today, then $1,800.00 on Sep 1 and monthly after that.',
    );
  }
});

test('first_month summary reflects the clamped Stripe minimum', () => {
  const summary = buildInviteProrationSummary({
    monthlyRetainerCents: 1_000,
    prorationMode: 'first_month',
    formatAmount,
    startedAt: new Date('2026-01-31T18:00:00.000Z'),
  });

  assert.equal(
    summary,
    'Charges $0.50 today (1 of 31 days), then $10.00 on Feb 1 and monthly after that.',
  );
});

test('getInviteProrationModeLabel returns admin-facing labels', () => {
  assert.equal(getInviteProrationModeLabel('second_month'), 'Full month today');
  assert.equal(getInviteProrationModeLabel('first_month'), 'Prorated today');
});
