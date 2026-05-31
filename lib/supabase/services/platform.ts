import { supabase } from '../client';
import type {
  AccountBilling,
  BillingAdjustment,
  PlatformInvitation,
  PlatformInvitationRevision,
  PlatformTermsVersion,
} from '../types';
import type { PlatformPaymentRoute } from '@/lib/billing/paymentRoutes';
import type { AgreementType } from '@/lib/platform-invite/terms';

export type { PlatformInvitationRevision, PlatformTermsVersion };

export interface PlatformInvitationInfo {
  status: string;
  invitee_email?: string;
  expires_at?: string | null;
  proposed_account_name?: string | null;
  monthly_retainer_cents?: number;
  currency?: string;
  first_month_discount_cents?: number;
  proposal_snapshot?: Record<string, unknown>;
  agreement_type?: AgreementType;
  terms_version?: string;
  terms_source_markdown?: string;
  terms_snapshot_markdown?: string;
  inviter_name?: string;
  viewed_at?: string | null;
  selected_payment_route?: PlatformPaymentRoute | null;
  selected_payment_route_fee_cents?: number;
  selected_payment_subtotal_cents?: number | null;
  selected_payment_total_cents?: number | null;
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
  | 'approved'
  | 'sent'
  | 'pending'
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
  first_month_discount_cents: number;
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

const rpc = (supabase as any).rpc.bind(supabase as any) as (fn: string, args?: Record<string, unknown>) => Promise<any>;

export async function getUserHasPlatformAdminAccess(userId: string): Promise<boolean> {
  const { getUserHasAccessFlag, ACCESS_FLAG_PLATFORM_ADMIN } = await import('./user-access-flags');
  return getUserHasAccessFlag(userId, ACCESS_FLAG_PLATFORM_ADMIN);
}

export async function getPlatformInvitationInfo(invitationId: string): Promise<PlatformInvitationInfo> {
  const { data, error } = await rpc('get_platform_invitation_info', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as PlatformInvitationInfo;
}

export async function createPlatformInvitation(params: {
  email: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  firstMonthDiscountCents?: number;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('create_platform_invitation', {
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_first_month_discount_cents: params.firstMonthDiscountCents ?? 0,
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function createPlatformInvitationDraft(params: {
  email: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  firstMonthDiscountCents?: number;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('create_platform_invitation_draft', {
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_first_month_discount_cents: params.firstMonthDiscountCents ?? 0,
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function updatePlatformInvitationDraft(params: {
  invitationId: string;
  email: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  firstMonthDiscountCents?: number;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('update_platform_invitation_draft', {
    p_invitation_id: params.invitationId,
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_first_month_discount_cents: params.firstMonthDiscountCents ?? 0,
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function markPlatformInvitationReady(invitationId: string): Promise<PlatformInvitation> {
  const { data, error } = await rpc('mark_platform_invitation_ready', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function publishPlatformInvitation(invitationId: string): Promise<PlatformInvitation> {
  const { data, error } = await rpc('publish_platform_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function revokePlatformInvitation(invitationId: string): Promise<PlatformInvitation> {
  const { data, error } = await rpc('revoke_platform_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function listPlatformInvitations(): Promise<PlatformInvitationListRow[]> {
  const { data, error } = await rpc('list_platform_invitations');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformInvitationListRow[];
}

export async function listPlatformInvitationRevisions(
  invitationId: string,
): Promise<PlatformInvitationRevisionSummary[]> {
  const { data, error } = await rpc('list_platform_invitation_revisions', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformInvitationRevisionSummary[];
}

export async function listPlatformAccountManagementRecords(): Promise<PlatformAccountManagementRecord[]> {
  const { data, error } = await rpc('list_platform_account_management_records');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccountManagementRecord[];
}

export async function getPlatformAccountManagementDetail(params: {
  recordId: string;
  recordKind: 'invitation' | 'account';
}): Promise<PlatformAccountManagementDetail> {
  const { data, error } = await rpc('get_platform_account_management_detail', {
    p_record_id: params.recordId,
    p_record_kind: params.recordKind,
  });
  if (error) throw new Error(error.message);
  const detail = (data ?? {}) as PlatformAccountManagementDetail;
  return {
    record_kind: detail.record_kind,
    invitation: detail.invitation ?? null,
    account: detail.account ?? null,
    billing: (detail.billing ?? null) as AccountBilling | null,
    adjustments: (detail.adjustments ?? []) as BillingAdjustment[],
    team_members: detail.team_members ?? [],
    revisions: (detail.revisions ?? []) as PlatformInvitationRevisionSummary[],
    source_invitation: detail.source_invitation ?? null,
  };
}

export async function listPlatformTermsVersions(): Promise<PlatformTermsVersion[]> {
  const { data, error } = await rpc('list_platform_terms_versions');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformTermsVersion[];
}

export async function createPlatformTermsVersion(params: {
  version: string;
  title: string;
  bodyMarkdown: string;
  effectiveAt?: string | null;
  isDefault?: boolean;
  agreementType?: AgreementType;
}): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('create_platform_terms_version', {
    p_version: params.version,
    p_title: params.title,
    p_body_markdown: params.bodyMarkdown,
    p_effective_at: params.effectiveAt ?? null,
    p_is_default: params.isDefault ?? false,
    p_agreement_type: params.agreementType ?? 'platform_agreement',
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}

export async function upsertPlatformTermsTemplate(params: {
  agreementType: AgreementType;
  title: string;
  bodyMarkdown: string;
}): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('upsert_platform_terms_template', {
    p_agreement_type: params.agreementType,
    p_title: params.title,
    p_body_markdown: params.bodyMarkdown,
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}

export async function setDefaultPlatformTermsVersion(version: string): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('set_default_platform_terms_version', {
    p_version: version,
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}

export async function preparePlatformInvitationCheckout(params: {
  invitationId: string;
  fullName: string;
  accountName: string;
  termsAcceptedIp?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('prepare_platform_invitation_checkout', {
    p_invitation_id: params.invitationId,
    p_full_name: params.fullName,
    p_account_name: params.accountName,
    p_terms_accepted_ip: params.termsAcceptedIp ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformInvitation;
}

export async function getSelfServeGuidanceInfo(email?: string | null): Promise<SelfServeGuidanceInfo> {
  const { data, error } = await rpc('get_self_serve_guidance_info', {
    p_email: email ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { email: null, is_known: false, primary_cta: 'book_call' }) as SelfServeGuidanceInfo;
}

export async function getAccountBilling(accountId: string): Promise<AccountBilling | null> {
  const { data, error } = await supabase
    .from('account_billing')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch account billing: ${error.message}`);
  return data as AccountBilling | null;
}

export async function listPlatformAccountBilling(): Promise<PlatformAccountBillingRow[]> {
  const { data, error } = await rpc('list_platform_account_billing');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccountBillingRow[];
}

export async function createBillingAdjustment(params: {
  accountId: string;
  billingYear: number;
  billingMonth: number;
  discountCents: number;
  reason: string;
}): Promise<BillingAdjustment> {
  const { data, error } = await rpc('create_billing_adjustment', {
    p_account_id: params.accountId,
    p_billing_year: params.billingYear,
    p_billing_month: params.billingMonth,
    p_discount_cents: params.discountCents,
    p_reason: params.reason,
  });
  if (error) throw new Error(error.message);
  return data as BillingAdjustment;
}

export async function listBillingAdjustments(accountId?: string | null): Promise<BillingAdjustment[]> {
  const { data, error } = await rpc('list_billing_adjustments', {
    p_account_id: accountId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingAdjustment[];
}
