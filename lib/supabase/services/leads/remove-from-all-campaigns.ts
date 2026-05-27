import { supabase } from '../../client';

export interface RemoveFromAllCampaignsResult {
  removed: number;
  skipped: number;
  errors: Array<{ globalLeadId?: string; message?: string }>;
}

type RpcResult = {
  removed?: number;
  skipped?: number;
  errors?: Array<{ globalLeadId?: string; message?: string }>;
};

export async function removeGlobalLeadsFromAllCampaigns(
  accountId: string,
  globalLeadIds: string[],
): Promise<RemoveFromAllCampaignsResult> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { removed: 0, skipped: 0, errors: [] };
  }

  const { data, error } = await supabase.rpc('remove_global_leads_from_all_campaigns', {
    p_account_id: accountId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = (data ?? {}) as RpcResult;
  return {
    removed: result.removed ?? 0,
    skipped: result.skipped ?? 0,
    errors: result.errors ?? [],
  };
}
