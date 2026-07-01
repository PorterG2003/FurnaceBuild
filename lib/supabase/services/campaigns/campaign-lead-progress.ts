import { supabase } from '../../client';

export interface CampaignLeadProgressBuckets {
  totalLeads: number;
  notStarted: number;
  inProgress: number;
  paused: number;
  completed: number;
  stopped: number;
}

type CampaignLeadProgressBucketsRpcRow = {
  total_leads: number | null;
  not_started: number | null;
  in_progress: number | null;
  paused: number | null;
  completed: number | null;
  stopped: number | null;
};

function mapBucketsRow(row: CampaignLeadProgressBucketsRpcRow | null | undefined): CampaignLeadProgressBuckets {
  return {
    totalLeads: row?.total_leads ?? 0,
    notStarted: row?.not_started ?? 0,
    inProgress: row?.in_progress ?? 0,
    paused: row?.paused ?? 0,
    completed: row?.completed ?? 0,
    stopped: row?.stopped ?? 0,
  };
}

export async function getCampaignLeadProgressBuckets(
  campaignId: string,
): Promise<CampaignLeadProgressBuckets> {
  const { data, error } = await supabase.rpc('get_campaign_lead_progress_buckets', {
    p_campaign_id: campaignId,
  });

  if (error) {
    throw new Error(`Failed to load campaign lead progress buckets: ${error.message}`);
  }

  const row = (data?.[0] ?? null) as CampaignLeadProgressBucketsRpcRow | null;
  return mapBucketsRow(row);
}

export async function getCampaignContactedLeadIds(campaignId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('get_campaign_contacted_lead_ids', {
    p_campaign_id: campaignId,
  });

  if (error) {
    throw new Error(`Failed to load contacted lead ids: ${error.message}`);
  }

  return new Set((data ?? []).filter(Boolean));
}
