import { supabase } from '../../client';

export interface PauseEnrollmentsReviewSummary {
  selectedPeople: number;
  activeInCampaign: number;
  alreadyPausedInCampaign: number;
  notInCampaign: number;
  terminalInCampaign: number;
  smartleadCampaign: boolean;
}

type RpcSummary = {
  selectedPeople?: number;
  activeInCampaign?: number;
  alreadyPausedInCampaign?: number;
  notInCampaign?: number;
  terminalInCampaign?: number;
  smartleadCampaign?: boolean;
};

export async function getPauseEnrollmentsReviewSummary(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<PauseEnrollmentsReviewSummary> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('pause_enrollments_review_summary', {
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
    activeInCampaign: summary.activeInCampaign ?? 0,
    alreadyPausedInCampaign: summary.alreadyPausedInCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    terminalInCampaign: summary.terminalInCampaign ?? 0,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}

export async function getPauseEnrollmentsReviewSummaryForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<PauseEnrollmentsReviewSummary> {
  const { data, error } = await supabase.rpc('pause_enrollments_review_summary_for_list', {
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
    activeInCampaign: summary.activeInCampaign ?? 0,
    alreadyPausedInCampaign: summary.alreadyPausedInCampaign ?? 0,
    notInCampaign: summary.notInCampaign ?? 0,
    terminalInCampaign: summary.terminalInCampaign ?? 0,
    smartleadCampaign: summary.smartleadCampaign ?? false,
  };
}
