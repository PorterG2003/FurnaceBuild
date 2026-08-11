import type { PlatformInvitation } from '../../types';
import {
  normalizePlatformInviteProrationMode,
  type PlatformInviteProrationMode,
} from '@/lib/billing/proration';
import type { AgreementType } from '@/lib/platform/contract/terms';
import { getPlatformInvitationErrorMessage } from './errors';
import { rpc } from './rpc';
import type {
  PlatformInvitationInfo,
  PlatformInvitationListRow,
  PlatformInvitationRevisionSummary,
  SelfServeGuidanceInfo,
} from './types';

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
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  prorationMode?: PlatformInviteProrationMode;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('create_platform_invitation', {
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_proration_mode: normalizePlatformInviteProrationMode(params.prorationMode),
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(getPlatformInvitationErrorMessage(error));
  return data as PlatformInvitation;
}

export async function createPlatformInvitationDraft(params: {
  email: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  prorationMode?: PlatformInviteProrationMode;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('create_platform_invitation_draft', {
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_proration_mode: normalizePlatformInviteProrationMode(params.prorationMode),
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(getPlatformInvitationErrorMessage(error));
  return data as PlatformInvitation;
}

export async function updatePlatformInvitationDraft(params: {
  invitationId: string;
  email: string;
  proposedAccountName?: string | null;
  monthlyRetainerCents: number;
  currency?: string;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
  autoAddInternalAdmins?: boolean;
  prorationMode?: PlatformInviteProrationMode;
  expiresAt?: string | null;
}): Promise<PlatformInvitation> {
  const { data, error } = await rpc('update_platform_invitation_draft', {
    p_invitation_id: params.invitationId,
    p_email: params.email,
    p_proposed_account_name: params.proposedAccountName ?? null,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
    p_auto_add_internal_admins: params.autoAddInternalAdmins ?? true,
    p_proration_mode: normalizePlatformInviteProrationMode(params.prorationMode),
    p_expires_at: params.expiresAt ?? null,
  });
  if (error) throw new Error(getPlatformInvitationErrorMessage(error));
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

export async function unpublishPlatformInvitation(invitationId: string): Promise<PlatformInvitation> {
  const { data, error } = await rpc('unpublish_platform_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(getPlatformInvitationErrorMessage(error));
  return data as PlatformInvitation;
}

export async function restorePlatformInvitationRevision(
  invitationId: string,
  revisionNumber: number,
): Promise<PlatformInvitation> {
  const { data, error } = await rpc('restore_platform_invitation_revision', {
    p_invitation_id: invitationId,
    p_revision_number: revisionNumber,
  });
  if (error) throw new Error(getPlatformInvitationErrorMessage(error));
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

export async function acceptPlatformInvitation(params: {
  invitationId: string;
  fullName: string;
  accountName: string;
  termsAcceptedIp?: string | null;
  internalAdminEmails?: string[];
}): Promise<{ status: string; account_id?: string | null; accepted_revision_number?: number | null }> {
  const internalAdminEmails = params.internalAdminEmails ?? [
    'porter@getfurnace.io',
    'kyle@getfurnace.io',
  ];
  const { data, error } = await rpc('accept_platform_invitation', {
    p_invitation_id: params.invitationId,
    p_full_name: params.fullName,
    p_account_name: params.accountName,
    p_terms_accepted_ip: params.termsAcceptedIp ?? null,
    p_internal_admin_emails: internalAdminEmails,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as {
    status: string;
    account_id?: string | null;
    accepted_revision_number?: number | null;
  };
}

export async function getSelfServeGuidanceInfo(email?: string | null): Promise<SelfServeGuidanceInfo> {
  const { data, error } = await rpc('get_self_serve_guidance_info', {
    p_email: email ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { email: null, is_known: false, primary_cta: 'book_call' }) as SelfServeGuidanceInfo;
}
