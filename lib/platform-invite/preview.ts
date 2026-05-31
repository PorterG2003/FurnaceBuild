import {
  buildPlatformPaymentQuote,
  getServerPlatformPaymentFeeConfig,
  type PlatformPaymentRoute,
} from '@/lib/billing/paymentRoutes';
import type { PlatformCheckoutQuote } from '@/lib/services/platform';
import type { PlatformInvitationRevisionSummary } from '@/lib/supabase/services/platform';
import type { PlatformInviteViewData } from './types';

const PREVIEW_STORAGE_PREFIX = 'platform-invite-preview:';

type PreviewInvitationRecord = {
  id: string;
  status: string;
};

export function buildPlatformInvitePreviewQuote(
  data: PlatformInviteViewData,
  paymentRoute: PlatformPaymentRoute,
): PlatformCheckoutQuote {
  const feeConfig = getServerPlatformPaymentFeeConfig()[paymentRoute];
  const quote = buildPlatformPaymentQuote({
    monthlyRetainerCents: data.monthlyRetainerCents,
    firstMonthDiscountCents: data.firstMonthDiscountCents,
    paymentRoute,
    routeConfig: feeConfig,
  });

  return {
    invitationId: data.invitationId ?? 'preview',
    paymentRoute,
    monthlyRetainerCents: data.monthlyRetainerCents,
    firstMonthDiscountCents: data.firstMonthDiscountCents,
    subtotalCents: quote.subtotalCents,
    routeFeeCents: quote.routeFeeCents,
    totalDueTodayCents: quote.totalDueTodayCents,
    currency: data.currency ?? 'usd',
    revisionNumber: data.revisionNumber ?? 0,
  };
}

export function mapPlatformInvitationRevisionToPreviewData(
  invitation: PreviewInvitationRecord,
  revision: PlatformInvitationRevisionSummary,
): PlatformInviteViewData {
  return {
    invitationId: invitation.id,
    status: invitation.status,
    inviteeEmail: revision.email,
    proposedAccountName: revision.proposed_account_name ?? null,
    monthlyRetainerCents: revision.monthly_retainer_cents,
    currency: revision.currency ?? 'usd',
    firstMonthDiscountCents: revision.first_month_discount_cents,
    proposalSnapshot: (revision.proposal_snapshot_json ?? {}) as Record<string, unknown>,
    agreementType: revision.agreement_type,
    termsVersion: revision.terms_version,
    termsSourceMarkdown: revision.terms_source_markdown ?? '',
    termsSnapshotMarkdown: revision.terms_snapshot_markdown ?? '',
    selectedPaymentRoute: 'card',
    revisionNumber: revision.revision_number,
  };
}

export function storePlatformInvitePreviewDraft(
  data: PlatformInviteViewData,
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

export function readPlatformInvitePreviewDraft(key: string): PlatformInviteViewData | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  const raw = window.localStorage.getItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { data?: PlatformInviteViewData };
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
  return `/admin-invite-preview${query ? `?${query}` : ''}`;
}
