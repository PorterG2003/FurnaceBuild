import { supabase } from '../../client';
import {
  mapAccountNodeStatsRows,
  type AccountNodeStatRow,
  type AccountNodeStatsRpcRow,
} from './account-node-stats-rpc-map';

export type { AccountNodeStatRow };
export { mapAccountNodeStatsRows };

export async function getAccountNodeStats(
  accountId: string,
  startDate?: string | null,
  endDate?: string | null,
  campaignIds?: string[] | null,
): Promise<AccountNodeStatRow[]> {
  const { data, error } = await supabase.rpc('account_node_stats', {
    p_account_id: accountId,
    p_start_date: startDate ?? null,
    p_end_date: endDate ?? null,
    p_campaign_ids: campaignIds != null && campaignIds.length > 0 ? campaignIds : null,
  });
  if (error) {
    throw new Error(`Failed to load account node stats: ${error.message}`);
  }
  return mapAccountNodeStatsRows((data ?? []) as AccountNodeStatsRpcRow[]);
}
