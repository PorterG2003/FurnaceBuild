import { supabase } from '../../client';

export interface RemoveFromCampaignReviewSummary {
  selectedPeople: number;
  inCampaign: number;
  notInCampaign: number;
  alreadyRemoved: number;
  smartleadCampaign: boolean;
}

type RpcSummary = {
  selectedPeople?: number;
  inCampaign?: number;
  notInCampaign?: number;
  alreadyRemoved?: number;
  smartleadCampaign?: boolean;
};

export async function getRemoveFromCampaignReviewSummary(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<RemoveFromCampaignReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('remove_from_campaign_review_summary', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    inCampaign: summary.inCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    alreadyRemoved: summary.alreadyRemoved ?? 0,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}

export async function getRemoveFromCampaignReviewSummaryForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<RemoveFromCampaignReviewSummary> {
  const { data, error } = await supabase.rpc('remove_from_campaign_review_summary_for_list', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_list_id: listId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    inCampaign: summary.inCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    alreadyRemoved: summary.alreadyRemoved ?? 0,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}
