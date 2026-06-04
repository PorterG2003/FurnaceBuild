import { useMemo } from 'react';
import type { PlatformContractViewData } from '@/lib/platform/contract/types';
import type { AgreementType } from '@/lib/platform/contract/terms';

export type AmendmentReviewPreviewInput = {
  ownerEmail: string;
  accountName: string;
  monthlyRetainerCents: number;
  proposalSnapshot: Record<string, unknown>;
  agreementType: AgreementType;
  selectedTermsVersion: string;
  termsSourceMarkdown: string;
  renderedTermsPreview: string;
  amendmentId?: string;
  inviterName?: string;
  status?: string;
};

export function buildAmendmentReviewPreviewData(
  input: AmendmentReviewPreviewInput,
): PlatformContractViewData | null {
  if (!input.ownerEmail.trim() || input.monthlyRetainerCents <= 0 || !input.renderedTermsPreview.trim()) {
    return null;
  }

  return {
    invitationId: input.amendmentId,
    status: input.status ?? 'pending_acceptance',
    inviteeEmail: input.ownerEmail.trim().toLowerCase(),
    proposedAccountName: input.accountName.trim() || null,
    monthlyRetainerCents: input.monthlyRetainerCents,
    currency: 'usd',
    proposalSnapshot: input.proposalSnapshot,
    agreementType: input.agreementType,
    termsVersion: input.selectedTermsVersion,
    termsSourceMarkdown: input.termsSourceMarkdown,
    termsSnapshotMarkdown: input.renderedTermsPreview,
    inviterName: input.inviterName,
  };
}

export function useAmendmentReviewPreviewData(input: AmendmentReviewPreviewInput) {
  return useMemo(() => buildAmendmentReviewPreviewData(input), [
    input.accountName,
    input.agreementType,
    input.amendmentId,
    input.inviterName,
    input.monthlyRetainerCents,
    input.ownerEmail,
    input.proposalSnapshot,
    input.renderedTermsPreview,
    input.selectedTermsVersion,
    input.status,
    input.termsSourceMarkdown,
  ]);
}
