import { supabase } from '../../client';

export interface PauseEnrollmentsResult {
  paused: number;
  skipped: number;
  errors: Array<{ globalLeadId?: string; message?: string }>;
}

type RpcResult = {
  paused?: number;
  skipped?: number;
  errors?: Array<{ globalLeadId?: string; message?: string }>;
};

export async function pauseEnrollmentsForLeads(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<PauseEnrollmentsResult> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { paused: 0, skipped: 0, errors: [] };
  }

  const { data, error } = await supabase.rpc('pause_enrollments_for_leads', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const result = (data ?? {}) as RpcResult;
  return {
    paused: result.paused ?? 0,
    skipped: result.skipped ?? 0,
    errors: result.errors ?? [],
  };
}
