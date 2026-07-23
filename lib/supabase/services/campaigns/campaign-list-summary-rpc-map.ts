import type {
  CampaignListSummary,
  CampaignsListSummaryCursor,
  CampaignsListSummaryRpcArgs,
  GetCampaignsListSummaryOpts,
} from './campaign-list-summary-types';

export type CampaignsListSummaryRpcRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  source: string | null;
  has_flow: boolean;
  sent_count: number;
  replied_count: number;
  positive_reply_count: number;
  bounce_count: number;
  enrollment_count: number;
  terminal_enrollment_count: number;
  contacted_enrollment_count: number;
};

export function buildCampaignsListSummaryRpcArgs(
  accountId: string,
  opts?: GetCampaignsListSummaryOpts,
): CampaignsListSummaryRpcArgs {
  const search = opts?.search?.trim() || null;
  const statuses = opts?.statuses?.length ? [...opts.statuses] : null;
  const tagIds = opts?.tagIds?.length ? [...opts.tagIds] : null;
  return {
    p_account_id: accountId,
    p_search: search,
    p_statuses: statuses,
    p_tag_ids: tagIds,
    p_limit: opts?.limit ?? null,
    p_cursor_created_at: opts?.cursor?.createdAt ?? null,
    p_cursor_id: opts?.cursor?.id ?? null,
  };
}

export function mapCampaignsListSummaryRpcRow(row: CampaignsListSummaryRpcRow): CampaignListSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status as CampaignListSummary['status'],
    createdAt: row.created_at,
    source: row.source,
    hasFlow: row.has_flow,
    sentCount: row.sent_count ?? 0,
    repliedCount: row.replied_count ?? 0,
    positiveReplyCount: row.positive_reply_count ?? 0,
    bounceCount: row.bounce_count ?? 0,
    enrollmentCount: row.enrollment_count ?? 0,
    terminalEnrollmentCount: row.terminal_enrollment_count ?? 0,
    contactedEnrollmentCount: row.contacted_enrollment_count ?? 0,
  };
}

export type { CampaignListSummary, CampaignsListSummaryCursor, GetCampaignsListSummaryOpts, CampaignsListSummaryRpcArgs };
