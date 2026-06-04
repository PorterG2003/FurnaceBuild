import type { AgreementType } from '@/lib/platform/contract/terms';
import { rpc } from './rpc';
import type {
  AcceptPlatformAccountAmendmentResult,
  PendingPlatformAccountAmendment,
  PlatformAccountAmendment,
  PlatformAccountAmendmentInfo,
  PlatformAccountAmendmentRevisionSummary,
} from './types';

export async function createPlatformAccountAmendmentDraft(params: {
  accountId: string;
  accountName: string;
  monthlyRetainerCents: number;
  currency?: string;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
}): Promise<PlatformAccountAmendment> {
  const { data, error } = await rpc('create_platform_account_amendment_draft', {
    p_account_id: params.accountId,
    p_account_name: params.accountName,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformAccountAmendment;
}

export async function updatePlatformAccountAmendmentDraft(params: {
  amendmentId: string;
  accountName: string;
  monthlyRetainerCents: number;
  currency?: string;
  proposalSnapshotJson: Record<string, unknown>;
  agreementType?: AgreementType | null;
  termsVersion?: string | null;
  termsSourceMarkdown?: string | null;
}): Promise<PlatformAccountAmendment> {
  const { data, error } = await rpc('update_platform_account_amendment_draft', {
    p_amendment_id: params.amendmentId,
    p_account_name: params.accountName,
    p_monthly_retainer_cents: params.monthlyRetainerCents,
    p_currency: params.currency ?? 'usd',
    p_proposal_snapshot_json: params.proposalSnapshotJson,
    p_terms_version: params.termsVersion ?? null,
    p_agreement_type: params.agreementType ?? null,
    p_terms_source_markdown: params.termsSourceMarkdown ?? null,
  });
  if (error) throw new Error(error.message);
  return data as PlatformAccountAmendment;
}

export async function publishPlatformAccountAmendment(
  amendmentId: string,
): Promise<PlatformAccountAmendment> {
  const { data, error } = await rpc('publish_platform_account_amendment', {
    p_amendment_id: amendmentId,
  });
  if (error) throw new Error(error.message);
  return data as PlatformAccountAmendment;
}

export async function cancelPlatformAccountAmendment(
  amendmentId: string,
): Promise<PlatformAccountAmendment> {
  const { data, error } = await rpc('cancel_platform_account_amendment', {
    p_amendment_id: amendmentId,
  });
  if (error) throw new Error(error.message);
  return data as PlatformAccountAmendment;
}

export async function getPendingPlatformAccountAmendment(
  accountId: string,
): Promise<PendingPlatformAccountAmendment | null> {
  const { data, error } = await rpc('get_pending_platform_account_amendment', {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return (data ?? null) as PendingPlatformAccountAmendment | null;
}

export async function getPlatformAccountAmendmentInfo(
  amendmentId: string,
): Promise<PlatformAccountAmendmentInfo> {
  const { data, error } = await rpc('get_platform_account_amendment_info', {
    p_amendment_id: amendmentId,
  });
  if (error) throw new Error(error.message);
  return (data ?? { status: 'not_found' }) as PlatformAccountAmendmentInfo;
}

export async function acceptPlatformAccountAmendment(params: {
  amendmentId: string;
  termsAcceptedIp?: string | null;
}): Promise<AcceptPlatformAccountAmendmentResult> {
  const { data, error } = await rpc('accept_platform_account_amendment', {
    p_amendment_id: params.amendmentId,
    p_terms_accepted_ip: params.termsAcceptedIp ?? null,
  });
  if (error) throw new Error(error.message);
  return data as AcceptPlatformAccountAmendmentResult;
}

export async function listPlatformAccountAmendmentRevisions(
  amendmentId: string,
): Promise<PlatformAccountAmendmentRevisionSummary[]> {
  const { data, error } = await rpc('list_platform_account_amendment_revisions', {
    p_amendment_id: amendmentId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccountAmendmentRevisionSummary[];
}

export async function listPlatformAccountAmendments(
  accountId: string,
): Promise<PlatformAccountAmendment[]> {
  const { data, error } = await rpc('list_platform_account_amendments', {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformAccountAmendment[];
}
