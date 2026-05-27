import { supabase } from '../../client';

export interface RemoveFromAllCampaignsReviewSummary {
  selectedPeople: number;
  nativeMembershipsToRemove: number;
  smartleadMembershipsSkipped: number;
  peopleWithReplies: number;
}

type RpcSummary = {
  selectedPeople?: number;
  nativeMembershipsToRemove?: number;
  smartleadMembershipsSkipped?: number;
  peopleWithReplies?: number;
};

export async function getRemoveFromAllCampaignsReviewSummary(
  accountId: string,
  globalLeadIds: string[],
): Promise<RemoveFromAllCampaignsReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('remove_from_all_campaigns_review_summary', {
    p_account_id: accountId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    nativeMembershipsToRemove: summary.nativeMembershipsToRemove ?? 0,
    smartleadMembershipsSkipped: summary.smartleadMembershipsSkipped ?? 0,
    peopleWithReplies: summary.peopleWithReplies ?? 0,
  };
}

export async function getRemoveFromAllCampaignsReviewSummaryForList(
  accountId: string,
  listId: string,
): Promise<RemoveFromAllCampaignsReviewSummary> {
  const { data, error } = await supabase.rpc('remove_from_all_campaigns_review_summary_for_list', {
    p_account_id: accountId,
    p_list_id: listId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    nativeMembershipsToRemove: summary.nativeMembershipsToRemove ?? 0,
    smartleadMembershipsSkipped: summary.smartleadMembershipsSkipped ?? 0,
    peopleWithReplies: summary.peopleWithReplies ?? 0,
  };
}
