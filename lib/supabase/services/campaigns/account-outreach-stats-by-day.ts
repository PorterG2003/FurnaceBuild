import { supabase } from '../../client';
import type { CampaignStatsByDay } from './campaign-stats';
import { mapCampaignStatsByDayRpcRows, type CampaignStatsByDayRpcRow } from './campaign-stats-by-day-rpc-map';

export async function getAccountOutreachStatsByDay(
  accountId: string,
  startDate: string,
  endDate: string,
  campaignIds?: string[] | null,
): Promise<CampaignStatsByDay[]> {
  const { data, error } = await supabase.rpc('account_outreach_stats_by_day', {
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_campaign_ids:
      campaignIds != null && campaignIds.length > 0 ? campaignIds : null,
  });
  if (error) {
    throw new Error(`Failed to load account outreach stats by day: ${error.message}`);
  }
  return mapCampaignStatsByDayRpcRows((data ?? []) as CampaignStatsByDayRpcRow[]);
}
