import type { AccountBilling, BillingAdjustment } from '../../types';
import { rpc } from './rpc';
import type {
  PlatformAccountManagementDetail,
  PlatformAccountManagementRecord,
  PlatformInvitationRevisionSummary,
} from './types';

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
