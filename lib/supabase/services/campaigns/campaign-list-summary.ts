import { supabase } from '../../client';

/**
 * One row for the campaigns list (from `campaigns_list_summary` RPC).
 *
 * Parity / validation (vs former getCampaigns + getCampaignStatsForCampaigns):
 * - enrollment + terminal counts: same as enrollments loop in campaign-stats.ts
 * - contacted: same as get_campaign_contacted_counts (distinct sent campaign message_jobs)
 * - sent/replied/positive/bounce: from campaign_stats
 * - hasFlow: true when flow_data.nodes is a non-empty JSON array (matches prior hasFlow())
 *
 * After deploy, spot-check one account in DevTools: one `campaigns_list_summary` call;
 * completion dial should match for campaigns previously missing from truncated enrollment rows.
 */
export interface CampaignListSummary {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'paused' | 'stopped';
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

type CampaignsListSummaryRpcRow = {
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

function mapRow(row: CampaignsListSummaryRpcRow): CampaignListSummary {
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

export async function getCampaignsListSummary(accountId: string): Promise<CampaignListSummary[]> {
  const { data, error } = await supabase.rpc('campaigns_list_summary', {
    p_account_id: accountId,
  });
  if (error) {
    throw new Error(`Failed to load campaigns list summary: ${error.message}`);
  }
  const rows = (data ?? []) as CampaignsListSummaryRpcRow[];
  return rows.map(mapRow);
}
