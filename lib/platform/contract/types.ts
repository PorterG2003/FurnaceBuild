import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { PlatformInviteProrationMode } from '@/lib/billing/proration';
import type { AgreementType } from './terms';

export type PlatformInviteStep = 'proposal' | 'terms' | 'payment' | 'account' | 'activating';

export interface PlatformContractViewData {
  invitationId?: string;
  status: string;
  inviteeEmail: string;
  expiresAt?: string | null;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  proposalSnapshot: Record<string, unknown>;
  agreementType: AgreementType;
  prorationMode?: PlatformInviteProrationMode;
  termsVersion?: string;
  termsSourceMarkdown?: string;
  termsSnapshotMarkdown: string;
  inviterName?: string;
  viewedAt?: string | null;
  selectedPaymentRoute?: PlatformPaymentRoute | null;
  selectedPaymentRouteFeeCents?: number;
  selectedPaymentSubtotalCents?: number | null;
  selectedPaymentTotalCents?: number | null;
  recurringAnchorAt?: string | null;
  // Locked total amount due on the first recurring invoice, including route fees when applicable.
  firstRecurringInvoiceTargetCents?: number | null;
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
  | { kind: 'activated'; accountId?: string | null }
  | { kind: 'preview_complete'; title?: string; message?: string };
