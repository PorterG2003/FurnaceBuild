import { supabase } from '../../client';
import type {
  AddGlobalLeadsToCampaignOptions,
  AddGlobalLeadsToCampaignResult,
  AddToCampaignPayloadResult,
} from './add-to-campaign-with-client';

export type { AddGlobalLeadsToCampaignOptions, AddGlobalLeadsToCampaignResult, AddToCampaignPayloadResult };

type RpcAddResult = {
  created?: number;
  updated?: number;
  enrolled?: number;
  skipped?: number;
  incomplete?: number;
  failed?: number;
  errors?: Array<{ globalLeadId?: string; message?: string }>;
};

function mapRpcResult(data: RpcAddResult | null): AddGlobalLeadsToCampaignResult {
  return {
    created: data?.created ?? 0,
    updated: data?.updated ?? 0,
    enrolled: data?.enrolled ?? 0,
    skipped: data?.skipped ?? 0,
    incomplete: data?.incomplete ?? 0,
    failed: data?.failed ?? 0,
    errors: (data?.errors ?? []).map((error) => ({
      globalLeadId: error.globalLeadId ?? '',
      message: error.message ?? 'Unknown error',
    })),
  };
}

export async function addGlobalLeadsToCampaign(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
  options: AddGlobalLeadsToCampaignOptions = {},
): Promise<AddGlobalLeadsToCampaignResult> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {
      created: 0,
      updated: 0,
      enrolled: 0,
      skipped: 0,
      incomplete: 0,
      failed: 0,
      errors: [],
    };
  }

  options.onProgress?.(0, uniqueIds.length);

  const { data, error } = await supabase.rpc('add_global_leads_to_campaign', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
    p_options: { source: 'Leads workbench' },
  });

  if (error) {
    throw new Error(error.message);
  }

  options.onProgress?.(uniqueIds.length, uniqueIds.length);
  return mapRpcResult(data as RpcAddResult | null);
}
