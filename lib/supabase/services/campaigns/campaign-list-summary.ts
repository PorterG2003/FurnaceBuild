import { supabase } from '../../client';
import {
  buildCampaignsListSummaryRpcArgs,
  mapCampaignsListSummaryRpcRow,
  type CampaignsListSummaryRpcRow,
} from './campaign-list-summary-rpc-map';
import type {
  CampaignListSummary,
  CampaignsListSummaryCursor,
  CampaignsListSummaryRpcArgs,
  GetCampaignsListSummaryOpts,
} from './campaign-list-summary-types';

export type {
  CampaignListSummary,
  CampaignsListSummaryCursor,
  CampaignsListSummaryRpcArgs,
  GetCampaignsListSummaryOpts,
};
export { buildCampaignsListSummaryRpcArgs, mapCampaignsListSummaryRpcRow };

/**
 * One row for the campaigns list (from `campaigns_list_summary` RPC).
 *
 * Parity / validation (vs former getCampaigns + getCampaignStatsForCampaigns):
 * - enrollment + terminal counts: live aggregates over non-deleted enrollments
 * - contacted: COUNT of enrollments with has_been_contacted (set on first campaign send)
 * - sent/replied/positive/bounce: from campaign_stats
 * - hasFlow: true when flow_data.nodes is a non-empty JSON array
 */
export async function getCampaignsListSummary(
  accountId: string,
  opts?: GetCampaignsListSummaryOpts,
): Promise<CampaignListSummary[]> {
  const { data, error } = await supabase.rpc(
    'campaigns_list_summary',
    buildCampaignsListSummaryRpcArgs(accountId, opts),
  );
  if (error) {
    throw new Error(`Failed to load campaigns list summary: ${error.message}`);
  }
  const rows = (data ?? []) as CampaignsListSummaryRpcRow[];
  return rows.map(mapCampaignsListSummaryRpcRow);
}
