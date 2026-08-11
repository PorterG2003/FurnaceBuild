import { useMemo } from 'react';
import {
  normalizePlatformInviteProrationMode,
  type PlatformInviteProrationMode,
} from '@/lib/billing/proration';
import type { PlatformContractViewData } from '@/lib/platform/contract/types';
import type { AgreementType } from '@/lib/platform/contract/terms';

export type InviteReviewPreviewInput = {
  inviteEmail: string;
  inviteCompanyName: string;
  monthlyRetainerCents: number | null;
  prorationMode: PlatformInviteProrationMode;
  proposalSnapshot: Record<string, unknown>;
  agreementType: AgreementType;
  selectedTermsVersion: string;
  termsSourceMarkdown: string;
  renderedTermsPreview: string;
  invitationId?: string;
  isEditing?: boolean;
};

export function buildInviteReviewPreviewData(input: InviteReviewPreviewInput): PlatformContractViewData | null {
  if (!input.inviteEmail.trim() || input.monthlyRetainerCents == null || input.monthlyRetainerCents < 0) {
    return null;
  }
  if (!input.termsSourceMarkdown.trim()) {
    return null;
  }

  return {
    invitationId: input.isEditing ? input.invitationId : undefined,
    status: 'draft',
    inviteeEmail: input.inviteEmail.trim().toLowerCase(),
    proposedAccountName: input.inviteCompanyName.trim() || null,
    monthlyRetainerCents: input.monthlyRetainerCents,
    currency: 'usd',
    proposalSnapshot: input.proposalSnapshot,
    agreementType: input.agreementType,
    prorationMode: normalizePlatformInviteProrationMode(input.prorationMode),
    termsVersion: input.selectedTermsVersion,
    termsSourceMarkdown: input.termsSourceMarkdown,
    termsSnapshotMarkdown: input.renderedTermsPreview,
    selectedPaymentRoute: 'card',
  };
}

export function useInviteReviewPreviewData(input: InviteReviewPreviewInput) {
  return useMemo(() => buildInviteReviewPreviewData(input), [
    input.agreementType,
    input.inviteCompanyName,
    input.inviteEmail,
    input.invitationId,
    input.isEditing,
    input.monthlyRetainerCents,
    input.prorationMode,
    input.proposalSnapshot,
    input.renderedTermsPreview,
    input.selectedTermsVersion,
    input.termsSourceMarkdown,
  ]);
}
