export interface CampaignListSummary {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'stopped';
  createdAt: string;
  source: string | null;
  hasFlow: boolean;
  sentCount: number;
  repliedCount: number;
  positiveReplyCount: number;
  bounceCount: number;
  enrollmentCount: number;
  terminalEnrollmentCount: number;
  contactedEnrollmentCount: number;
}

export type CampaignsListSummaryCursor = {
  createdAt: string;
  id: string;
};

export type GetCampaignsListSummaryOpts = {
  search?: string | null;
  statuses?: CampaignListSummary['status'][] | null;
  tagIds?: string[] | null;
  limit?: number | null;
  cursor?: CampaignsListSummaryCursor | null;
};

export type CampaignsListSummaryRpcArgs = {
  p_account_id: string;
  p_search: string | null;
  p_statuses: string[] | null;
  p_tag_ids: string[] | null;
  p_limit: number | null;
  p_cursor_created_at: string | null;
  p_cursor_id: string | null;
};
