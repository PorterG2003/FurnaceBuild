import { supabase } from '../../client';

export interface AddToCampaignReviewSummary {
  selectedPeople: number;
  alreadyInCampaign: number;
  membershipsInScope: number;
  nativeMemberships: number;
  smartleadMemberships: number;
  peopleWithReplies: number;
  peopleWithConflictingCompanies: number;
}

type RpcReviewSummary = {
  selectedPeople?: number;
  alreadyInCampaign?: number;
  membershipsInScope?: number;
  nativeMemberships?: number;
  smartleadMemberships?: number;
  peopleWithReplies?: number;
  peopleWithConflictingCompanies?: number;
};

export async function getAddToCampaignReviewSummary(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<AddToCampaignReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('add_to_campaign_review_summary', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcReviewSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    alreadyInCampaign: summary.alreadyInCampaign ?? 0,
    membershipsInScope: summary.membershipsInScope ?? 0,
    nativeMemberships: summary.nativeMemberships ?? 0,
    smartleadMemberships: summary.smartleadMemberships ?? 0,
    peopleWithReplies: summary.peopleWithReplies ?? 0,
    peopleWithConflictingCompanies: summary.peopleWithConflictingCompanies ?? 0,
  };
}

export async function getAddToCampaignReviewSummaryForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<AddToCampaignReviewSummary> {
  const { data, error } = await supabase.rpc('add_to_campaign_review_summary_for_list', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_list_id: listId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const summary = (data ?? {}) as RpcReviewSummary;
  return {
    selectedPeople: summary.selectedPeople ?? 0,
    alreadyInCampaign: summary.alreadyInCampaign ?? 0,
    membershipsInScope: summary.membershipsInScope ?? 0,
    nativeMemberships: summary.nativeMemberships ?? 0,
    smartleadMemberships: summary.smartleadMemberships ?? 0,
    peopleWithReplies: summary.peopleWithReplies ?? 0,
    peopleWithConflictingCompanies: summary.peopleWithConflictingCompanies ?? 0,
  };
}
