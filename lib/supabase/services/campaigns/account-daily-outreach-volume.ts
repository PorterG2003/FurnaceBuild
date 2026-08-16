import { supabase } from '../../client';
import {
  mapAccountDailyOutreachVolumeRows,
  type AccountDailyOutreachVolume,
  type AccountDailyOutreachVolumeRpcRow,
} from './account-daily-outreach-volume-rpc-map';

export type { AccountDailyOutreachVolume };
export { mapAccountDailyOutreachVolumeRows };

export async function getAccountDailyOutreachVolume(
  accountId: string,
  startDate: string,
  endDate: string,
  campaignIds?: string[] | null,
): Promise<AccountDailyOutreachVolume[]> {
  const { data, error } = await supabase.rpc('account_daily_outreach_volume', {
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_campaign_ids: campaignIds != null && campaignIds.length > 0 ? campaignIds : null,
  });
  if (error) {
    throw new Error(`Failed to load daily outreach volume: ${error.message}`);
  }
  return mapAccountDailyOutreachVolumeRows((data ?? []) as AccountDailyOutreachVolumeRpcRow[]);
}
