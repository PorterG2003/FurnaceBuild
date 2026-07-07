import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign } from '../../types';
import type { Database } from '../../types/database';

type DbClient = SupabaseClient<Database>;

export async function updateCampaignFlowDataWithClient(
  db: DbClient,
  params: {
    campaignId: string;
    accountId: string;
    flowData: Campaign['flow_data'];
    changeSource?: string;
  },
): Promise<Campaign> {
  const { campaignId, accountId, flowData, changeSource = 'client_api' } = params;
  const { data, error } = await db.rpc('update_campaign_flow_data_as_service', {
    p_campaign_id: campaignId,
    p_account_id: accountId,
    p_flow_data: flowData,
    p_change_source: changeSource,
  } as never);

  if (error) {
    const functionMissing =
      error.message.includes('Could not find the function public.update_campaign_flow_data_as_service')
      || error.message.includes('schema cache');
    if (!functionMissing) {
      throw new Error(`Failed to update campaign flow: ${error.message}`);
    }

    const { data: fallbackCampaign, error: fallbackError } = await db
      .from('campaigns')
      .update({
        flow_data: flowData,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', campaignId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (fallbackError) {
      throw new Error(`Failed to update campaign flow: ${fallbackError.message}`);
    }
    if (!fallbackCampaign) {
      throw new Error('Failed to update campaign flow: No data returned');
    }
    return fallbackCampaign as Campaign;
  }

  const campaign = Array.isArray(data) ? data[0] : data;
  if (!campaign) {
    throw new Error('Failed to update campaign flow: No data returned');
  }
  return campaign as Campaign;
}
