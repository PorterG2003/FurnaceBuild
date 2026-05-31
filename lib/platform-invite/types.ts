import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { AgreementType } from './terms';

export type PlatformInviteStep = 'proposal' | 'terms' | 'payment' | 'account' | 'activating';

export interface PlatformInviteViewData {
  invitationId?: string;
  status: string;
  inviteeEmail: string;
  expiresAt?: string | null;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  firstMonthDiscountCents: number;
  proposalSnapshot: Record<string, unknown>;
  agreementType: AgreementType;
  termsVersion?: string;
  termsSourceMarkdown?: string;
  termsSnapshotMarkdown: string;
  inviterName?: string;
  viewedAt?: string | null;
  selectedPaymentRoute?: PlatformPaymentRoute | null;
  selectedPaymentRouteFeeCents?: number;
  selectedPaymentSubtotalCents?: number | null;
  selectedPaymentTotalCents?: number | null;
  revisionNumber?: number | null;
}

export interface PlatformInviteCheckoutInput {
  invitationId?: string;
  paymentRoute: PlatformPaymentRoute;
  fullName: string;
  accountName: string;
  password: string;
  inviteEmail: string;
  hasMatchingAuthUser: boolean;
}

export type PlatformInviteCheckoutResult =
  | { kind: 'redirect' }
  | { kind: 'preview_complete'; title?: string; message?: string };
