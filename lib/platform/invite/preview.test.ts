import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlatformInvitePreviewQuote } from './preview';
import type { PlatformContractViewData } from '../contract/types';

const basePreviewData: PlatformContractViewData = {
  invitationId: 'preview',
  status: 'draft',
  inviteeEmail: 'prospect@example.com',
  proposedAccountName: 'Preview Workspace',
  monthlyRetainerCents: 180_000,
  currency: 'usd',
  proposalSnapshot: {},
  agreementType: 'platform_agreement',
  termsSnapshotMarkdown: '# Terms',
};

const previewStartedAt = new Date('2026-05-15T10:00:00.000Z');

test('buildPlatformInvitePreviewQuote returns the corrected prorated recurring amount', () => {
  const quote = buildPlatformInvitePreviewQuote(basePreviewData, 'card', { startedAt: previewStartedAt });

  assert.equal(quote.recurringAnchorAt, '2026-06-01T07:00:00.000Z');
  assert.equal(quote.firstRecurringSubtotalCents, 96_000);
  assert.equal(quote.firstRecurringRouteFeeCents, 2_814);
  assert.equal(quote.firstRecurringInvoiceCents, 98_814);
  assert.equal(quote.firstRecurringDiscountCents, 84_000);
  assert.equal(quote.ongoingMonthlyRouteFeeCents, 5_250);
  assert.equal(quote.ongoingMonthlyTotalCents, 185_250);
});

test('buildPlatformInvitePreviewQuote keeps ACH future totals equal to the retainer subtotals', () => {
  const quote = buildPlatformInvitePreviewQuote(basePreviewData, 'ach', { startedAt: previewStartedAt });

  assert.equal(quote.firstRecurringSubtotalCents, 96_000);
  assert.equal(quote.firstRecurringRouteFeeCents, 0);
  assert.equal(quote.firstRecurringInvoiceCents, 96_000);
  assert.equal(quote.ongoingMonthlyRouteFeeCents, 0);
  assert.equal(quote.ongoingMonthlyTotalCents, 180_000);
});

test('buildPlatformInvitePreviewQuote defaults to second-month proration', () => {
  const quote = buildPlatformInvitePreviewQuote(basePreviewData, 'ach', { startedAt: previewStartedAt });

  assert.equal(quote.prorationMode, 'second_month');
  assert.equal(quote.subtotalCents, 180_000);
  assert.equal(quote.dueTodayCoveredDays, quote.dueTodayMonthDays);
});

test('buildPlatformInvitePreviewQuote prorates today and keeps the anchor invoice full for first_month', () => {
  const quote = buildPlatformInvitePreviewQuote(
    { ...basePreviewData, prorationMode: 'first_month' },
    'ach',
    { startedAt: new Date('2026-08-15T10:00:00.000Z') },
  );

  assert.equal(quote.prorationMode, 'first_month');
  assert.equal(quote.subtotalCents, 98_710);
  assert.equal(quote.totalDueTodayCents, 98_710);
  assert.equal(quote.dueTodayCoveredDays, 17);
  assert.equal(quote.dueTodayMonthDays, 31);
  assert.equal(quote.firstRecurringDiscountCents, 0);
  assert.equal(quote.firstRecurringInvoiceCents, 180_000);
  assert.equal(quote.ongoingMonthlyTotalCents, 180_000);
});

test('buildPlatformInvitePreviewQuote adds the card fee on top of a prorated subtotal', () => {
  const quote = buildPlatformInvitePreviewQuote(
    { ...basePreviewData, prorationMode: 'first_month' },
    'card',
    { startedAt: new Date('2026-08-15T10:00:00.000Z') },
  );

  assert.equal(quote.subtotalCents, 98_710);
  assert.equal(quote.routeFeeCents, 2_893);
  assert.equal(quote.totalDueTodayCents, 101_603);
  assert.equal(quote.monthlyRetainerCents, 180_000);
});
