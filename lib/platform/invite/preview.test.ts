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
