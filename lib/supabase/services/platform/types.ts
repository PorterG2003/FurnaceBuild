import type { AccountBilling, BillingAdjustment, PlatformInvitationRevision, PlatformTermsVersion } from '../../types';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { PlatformInviteProrationMode } from '@/lib/billing/proration';
import type { AgreementType } from '@/lib/platform/contract/terms';

export type { PlatformInvitationRevision, PlatformTermsVersion };

export interface PlatformInvitationInfo {
  status: string;
  invitee_email?: string;
  expires_at?: string | null;
  proposed_account_name?: string | null;
  monthly_retainer_cents?: number;
  currency?: string;
  proposal_snapshot?: Record<string, unknown>;
  agreement_type?: AgreementType;
  terms_version?: string;
  terms_source_markdown?: string;
  terms_snapshot_markdown?: string;
  proration_mode?: PlatformInviteProrationMode;
  inviter_name?: string;
  viewed_at?: string | null;
  selected_payment_route?: PlatformPaymentRoute | null;
  selected_payment_route_fee_cents?: number;
  selected_payment_subtotal_cents?: number | null;
  selected_payment_total_cents?: number | null;
  recurring_anchor_at?: string | null;
  first_recurring_invoice_target_cents?: number | null;
  created_account_id?: string | null;
  checkout_phase?: string | null;
  checkout_session_id?: string | null;
  checkout_failure_summary?: string | null;
  has_hosted_verification?: boolean;
}

export interface SelfServeGuidanceInfo {
  email: string | null;
  is_known: boolean;
  primary_cta: 'book_call' | 'email_support';
}

export interface PlatformAccountBillingRow {
  account_id: string;
  account_name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  monthly_retainer_cents: number;
  billing_status: string;
  frontend_access_blocked_at: string | null;
  last_payment_failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PlatformInvitationLifecycleStatus =
  | 'draft'
  | 'sent'
  | 'pending_payment'
  | 'active'
  | 'expired'
  | 'revoked';

export interface PlatformInvitationListRow {
  id: string;
  email: string;
  status: PlatformInvitationLifecycleStatus;
  expires_at: string | null;
  viewed_at: string | null;
  proposed_account_name: string | null;
  monthly_retainer_cents: number;
  currency: string;
  terms_version: string;
  created_account_id: string | null;
  invited_by_user_name: string;
  accepted_by_user_name: string | null;
  current_revision_number: number;
  published_revision_number: number | null;
  accepted_revision_number: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PlatformInvitationRevisionSummary extends PlatformInvitationRevision {
  created_by_user_name: string;
  is_current: boolean;
  is_published: boolean;
  is_checkout: boolean;
  is_accepted: boolean;
}

export interface PlatformAccountManagementRecord {
  record_kind: 'invitation' | 'account';
  record_id: string;
  invitation_id: string | null;
  account_id: string | null;
  lifecycle_status: PlatformInvitationLifecycleStatus | 'active';
  revision_state: string | null;
  display_name: string;
  primary_email: string | null;
  monthly_retainer_cents: number | null;
  billing_status: string | null;
  current_revision_number: number | null;
  published_revision_number: number | null;
  accepted_revision_number: number | null;
  sent_at: string | null;
  last_activity_at: string | null;
  updated_at: string;
  has_pending_terms?: boolean;
  has_amendment_draft?: boolean;
  has_scheduled_downgrade?: boolean;
  agreement_type?: AgreementType | null;
  plan_tier?: string | null;
}

export interface PlatformAccountManagementDetail {
  record_kind: 'invitation' | 'account';
  invitation?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  billing?: AccountBilling | null;
  adjustments: BillingAdjustment[];
  team_members: Array<Record<string, unknown>>;
  revisions: PlatformInvitationRevisionSummary[];
  source_invitation?: Record<string, unknown> | null;
}

export type PlatformAccountAmendmentStatus =
  | 'draft'
  | 'pending_acceptance'
  | 'pending_payment'
  | 'accepted'
  | 'superseded'
  | 'canceled';

export interface PlatformAccountAmendment {
  id: string;
  account_id: string;
  status: PlatformAccountAmendmentStatus;
  current_revision_number: number;
  published_revision_number: number | null;
  accepted_revision_number: number | null;
  published_at: string | null;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  terms_accepted_ip: string | null;
  payment_started_at: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformAccountAmendmentRevision {
  id: string;
  amendment_id: string;
  revision_number: number;
  account_name: string;
  monthly_retainer_cents: number;
  currency: string;
  proposal_snapshot_json: Record<string, unknown>;
  agreement_type: AgreementType;
  terms_version: string;
  terms_snapshot_markdown: string;
  created_by_user_id: string;
  created_at: string;
}

export interface PlatformAccountAmendmentRevisionSummary extends PlatformAccountAmendmentRevision {
  created_by_user_name: string;
  is_current: boolean;
  is_published: boolean;
  is_accepted: boolean;
}

export interface PendingPlatformAccountAmendment {
  amendment_id: string;
  account_id: string;
  status: 'pending_acceptance' | 'pending_payment';
  published_revision_number: number | null;
  published_at: string | null;
  account_name: string;
  monthly_retainer_cents: number;
  currency: string;
  proposal_snapshot_json: Record<string, unknown>;
  agreement_type: AgreementType;
  terms_version: string;
  terms_snapshot_markdown: string;
}

export interface PlatformAccountAmendmentInfo {
  status: 'not_found' | 'unavailable' | 'pending_acceptance' | 'pending_payment';
  amendment_id?: string;
  account_id?: string;
  account_name?: string;
  current_monthly_retainer_cents?: number;
  proposed_monthly_retainer_cents?: number;
  currency?: string;
  proposal_snapshot_json?: Record<string, unknown>;
  agreement_type?: AgreementType;
  terms_version?: string;
  terms_snapshot_markdown?: string;
  published_revision_number?: number | null;
  published_at?: string | null;
  payment_started_at?: string | null;
  preferred_payment_route?: PlatformPaymentRoute | null;
}

export interface AcceptPlatformAccountAmendmentResult {
  status: 'accepted' | 'pending_payment';
  billing_change_kind: 'upgrade' | 'downgrade' | 'unchanged';
  requires_stripe_apply: boolean;
  account_id: string;
  old_monthly_retainer_cents?: number;
  new_monthly_retainer_cents?: number;
  amendment_id?: string;
  scheduled_monthly_retainer_cents?: number;
  payment_started_at?: string | null;
  preferred_payment_route?: PlatformPaymentRoute | null;
}

export interface AdminUpdateAccountBillingResult {
  billing_change_kind: 'upgrade' | 'downgrade' | 'unchanged';
  requires_stripe_apply: boolean;
  account_id: string;
  old_monthly_retainer_cents: number;
  new_monthly_retainer_cents: number;
  scheduled_monthly_retainer_cents?: number | null;
  scheduled_retainer_effective_at?: string | null;
}
