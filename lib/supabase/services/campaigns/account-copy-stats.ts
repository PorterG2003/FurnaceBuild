import type { CopyPieceKind } from '../../../copy/kinds';
import { supabase } from '../../client';
import {
  mapAccountCopyStatsPayload,
  type AccountCopyStats,
  type CopyStatsGroupBy,
} from './account-copy-stats-rpc-map';

export type {
  AccountCopyStats,
  AccountCopyStatRow,
  CopyStatsGroupBy,
  CopyStatsWording,
} from './account-copy-stats-rpc-map';

export async function getAccountCopyStats(
  accountId: string,
  startDate?: string | null,
  endDate?: string | null,
  campaignIds?: string[] | null,
  kind?: CopyPieceKind | null,
  groupBy: CopyStatsGroupBy = 'archetype',
): Promise<AccountCopyStats> {
  const { data, error } = await supabase.rpc('account_copy_stats' as never, {
    p_account_id: accountId,
    p_start_date: startDate ?? null,
    p_end_date: endDate ?? null,
    p_campaign_ids: campaignIds?.length ? campaignIds : null,
    p_kind: kind ?? null,
    p_group_by: groupBy,
  } as never);
  if (error) throw new Error(`Failed to load copy stats: ${error.message}`);

  return mapAccountCopyStatsPayload(data);
}
