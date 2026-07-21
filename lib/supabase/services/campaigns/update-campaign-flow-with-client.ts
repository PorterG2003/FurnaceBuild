import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign } from '../../types';
import type { Database } from '../../types/database';
import type { CampaignFlowSaveResult } from './campaigns';

type DbClient = SupabaseClient<Database>;

function parseCampaignFlowSaveRpcResult(data: unknown): CampaignFlowSaveResult {
  if (data && typeof data === 'object' && 'campaign' in data) {
    const record = data as { campaign: Campaign; reactivated_count?: number };
    return {
      campaign: record.campaign,
      reactivated_count: record.reactivated_count ?? 0,
    };
  }
  const campaign = (Array.isArray(data) ? data[0] : data) as Campaign | null;
  if (!campaign) {
    throw new Error('Failed to update campaign flow: No data returned');
  }
  return { campaign, reactivated_count: 0 };
}

export async function updateCampaignFlowDataWithClient(
  db: DbClient,
  params: {
    campaignId: string;
    accountId: string;
    flowData: Campaign['flow_data'];
    changeSource?: string;
  },
): Promise<CampaignFlowSaveResult> {
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
    if (functionMissing) {
      throw new Error(
        'Failed to update campaign flow: update_campaign_flow_data_as_service RPC is missing. Refusing silent flow_data UPDATE that would skip lifecycle enforcement and enrollment reactivation.',
      );
    }
    throw new Error(`Failed to update campaign flow: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update campaign flow: No data returned');
  }
  return parseCampaignFlowSaveRpcResult(data);
}
