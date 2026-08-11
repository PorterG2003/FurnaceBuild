import {
  buildPlatformPaymentQuote,
  buildPlatformRecurringInvoiceQuote,
  getServerPlatformPaymentFeeConfig,
  type PlatformPaymentRoute,
} from '@/lib/billing/paymentRoutes';
import {
  buildBillingAnchorPlan,
  normalizePlatformInviteProrationMode,
} from '@/lib/billing/proration';
import type { PlatformCheckoutQuote } from '@/lib/services/platform';
import type { PlatformInvitationRevisionSummary } from '@/lib/supabase/services/platform';
import type { PlatformContractViewData } from '../contract/types';

const PREVIEW_STORAGE_PREFIX = 'platform-invite-preview:';

type PreviewInvitationRecord = {
  id: string;
  status: string;
};

export function buildPlatformInvitePreviewQuote(
  data: PlatformContractViewData,
  paymentRoute: PlatformPaymentRoute,
  options?: { startedAt?: Date },
): PlatformCheckoutQuote {
  const feeConfig = getServerPlatformPaymentFeeConfig()[paymentRoute];
  const previewStartedAt = options?.startedAt ?? new Date();
  const plan = buildBillingAnchorPlan(
    previewStartedAt,
    data.monthlyRetainerCents,
    normalizePlatformInviteProrationMode(data.prorationMode),
  );
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: data.monthlyRetainerCents,
    dueTodaySubtotalCents: plan.dueTodaySubtotalCents,
    paymentRoute,
    routeConfig: feeConfig,
  });
  const recurringQuote = buildPlatformRecurringInvoiceQuote({
    monthlyRetainerCents: data.monthlyRetainerCents,
    firstRecurringSubtotalCents: plan.firstRecurringAmountDueCents,
    paymentRoute,
    routeConfig: feeConfig,
  });

  return {
    invitationId: data.invitationId ?? 'preview',
    paymentRoute,
    monthlyRetainerCents: data.monthlyRetainerCents,
    subtotalCents: quote.subtotalCents,
    routeFeeCents: quote.routeFeeCents,
    totalDueTodayCents: quote.totalDueTodayCents,
    recurringAnchorAt: plan.anchorDateIso,
    prorationMode: plan.prorationMode,
    dueTodayCoveredDays: plan.dueTodayCoveredDays,
    dueTodayMonthDays: plan.dueTodayMonthDays,
    firstRecurringSubtotalCents: recurringQuote.firstRecurringSubtotalCents,
    firstRecurringRouteFeeCents: recurringQuote.firstRecurringRouteFeeCents,
    firstRecurringInvoiceCents: recurringQuote.firstRecurringTotalCents,
    firstRecurringDiscountCents: plan.overlapCreditCents,
    ongoingMonthlyRetainerCents: data.monthlyRetainerCents,
    ongoingMonthlyRouteFeeCents: recurringQuote.ongoingMonthlyRouteFeeCents,
    ongoingMonthlyTotalCents: recurringQuote.ongoingMonthlyTotalCents,
    currency: data.currency ?? 'usd',
    revisionNumber: data.revisionNumber ?? 0,
  };
}

export function mapPlatformInvitationRevisionToPreviewData(
  invitation: PreviewInvitationRecord,
  revision: PlatformInvitationRevisionSummary,
): PlatformContractViewData {
  return {
    invitationId: invitation.id,
    status: invitation.status,
    inviteeEmail: revision.email,
    proposedAccountName: revision.proposed_account_name ?? null,
    monthlyRetainerCents: revision.monthly_retainer_cents,
    currency: revision.currency ?? 'usd',
    proposalSnapshot: (revision.proposal_snapshot_json ?? {}) as Record<string, unknown>,
    agreementType: revision.agreement_type,
    prorationMode: normalizePlatformInviteProrationMode(revision.proration_mode),
    termsVersion: revision.terms_version,
    termsSourceMarkdown: revision.terms_source_markdown ?? '',
    termsSnapshotMarkdown: revision.terms_snapshot_markdown ?? '',
    selectedPaymentRoute: 'card',
    revisionNumber: revision.revision_number,
  };
}

export function storePlatformInvitePreviewDraft(
  data: PlatformContractViewData,
  existingKey?: string,
): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Interactive preview is only available in a browser context.');
  }

  const key =
    existingKey ??
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  window.localStorage.setItem(
    `${PREVIEW_STORAGE_PREFIX}${key}`,
    JSON.stringify({
      savedAt: Date.now(),
      data,
    }),
  );

  return key;
}

export function readPlatformInvitePreviewDraft(key: string): PlatformContractViewData | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  const raw = window.localStorage.getItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { data?: PlatformContractViewData };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export function buildAdminInvitePreviewUrl(params: {
  draftKey?: string;
  invitationId?: string;
  revisionNumber?: number | null;
  embedded?: boolean;
}) {
  const search = new URLSearchParams();
  if (params.draftKey) search.set('draftKey', params.draftKey);
  if (params.invitationId) search.set('invitationId', params.invitationId);
  if (typeof params.revisionNumber === 'number') {
    search.set('revisionNumber', String(params.revisionNumber));
  }
  if (params.embedded) {
    search.set('embedded', '1');
  }
  const query = search.toString();
  return `/admin/invite-preview${query ? `?${query}` : ''}`;
}
