import type { CampaignDbHarness } from './harness';
import type { AddGlobalLeadsToCampaignResult } from '../../supabase/services/leads/add-to-campaign-with-client';

type RpcAddResult = {
  created?: number;
  updated?: number;
  enrolled?: number;
  skipped?: number;
  failed?: number;
  errors?: Array<{ globalLeadId?: string; message?: string }>;
};

export async function callAddGlobalLeadsToCampaignRpc(
  harness: CampaignDbHarness,
  params: {
    campaignId: string;
    globalLeadIds: string[];
    source?: string;
  },
): Promise<AddGlobalLeadsToCampaignResult> {
  const { data, error } = await harness.supabase.rpc('add_global_leads_to_campaign', {
    p_account_id: harness.env.accountId,
    p_campaign_id: params.campaignId,
    p_global_lead_ids: params.globalLeadIds,
    p_options: { source: params.source ?? 'test' },
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = (data ?? {}) as RpcAddResult;
  return {
    created: row.created ?? 0,
    updated: row.updated ?? 0,
    enrolled: row.enrolled ?? 0,
    skipped: row.skipped ?? 0,
    failed: row.failed ?? 0,
    errors: (row.errors ?? []).map((entry) => ({
      globalLeadId: entry.globalLeadId ?? '',
      message: entry.message ?? 'Unknown error',
    })),
  };
}

export async function loadRollupRow(
  harness: CampaignDbHarness,
  globalLeadId: string,
) {
  const { data, error } = await harness.supabase
    .from('account_lead_people')
    .select('*')
    .eq('account_id', harness.env.accountId)
    .eq('global_lead_id', globalLeadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
