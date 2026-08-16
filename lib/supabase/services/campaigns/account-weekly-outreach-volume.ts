import { supabase } from '../../client';
import {
  mapAccountWeeklyOutreachVolumeRows,
  type AccountWeeklyOutreachVolume,
  type AccountWeeklyOutreachVolumeRpcRow,
} from './account-weekly-outreach-volume-rpc-map';

export type { AccountWeeklyOutreachVolume };
export { mapAccountWeeklyOutreachVolumeRows };

export async function getAccountWeeklyOutreachVolume(
  accountId: string,
  startDate: string,
  endDate: string,
  campaignIds?: string[] | null,
): Promise<AccountWeeklyOutreachVolume[]> {
  const { data, error } = await supabase.rpc('account_weekly_outreach_volume', {
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_campaign_ids: campaignIds != null && campaignIds.length > 0 ? campaignIds : null,
  });
  if (error) {
    throw new Error(`Failed to load weekly outreach volume: ${error.message}`);
  }
  return mapAccountWeeklyOutreachVolumeRows((data ?? []) as AccountWeeklyOutreachVolumeRpcRow[]);
}
