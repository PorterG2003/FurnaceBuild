import { supabase } from '../../client';

export interface ResumeEnrollmentsReviewSummary {
  selectedPeople: number;
  pausedInCampaign: number;
  alreadyActiveInCampaign: number;
  notInCampaign: number;
  campaignNotRunning: boolean;
  smartleadCampaign: boolean;
}

type RpcSummary = {
  selectedPeople?: number;
  pausedInCampaign?: number;
  alreadyActiveInCampaign?: number;
  notInCampaign?: number;
  campaignNotRunning?: boolean;
  smartleadCampaign?: boolean;
};

export async function getResumeEnrollmentsReviewSummary(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<ResumeEnrollmentsReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('resume_enrollments_review_summary', {
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
    pausedInCampaign: summary.pausedInCampaign ?? 0,
    alreadyActiveInCampaign: summary.alreadyActiveInCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    campaignNotRunning: summary.campaignNotRunning ?? false,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}

export async function getResumeEnrollmentsReviewSummaryForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<ResumeEnrollmentsReviewSummary> {
  const { data, error } = await supabase.rpc('resume_enrollments_review_summary_for_list', {
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
    pausedInCampaign: summary.pausedInCampaign ?? 0,
    alreadyActiveInCampaign: summary.alreadyActiveInCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    campaignNotRunning: summary.campaignNotRunning ?? false,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}
