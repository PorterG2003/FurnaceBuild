import { supabase } from '../../client';

export async function ensureCampaignEnrollmentsForLeads(
  campaignId: string,
  leadIds: string[],
  enrollmentStates?: ('active' | 'completed' | 'stopped' | 'paused')[]
): Promise<void> {
  if (!leadIds.length) return;

  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('account_id, deleted_at')
    .eq('id', campaignId)
    .single();
  if (campError || !campaign?.account_id) {
    throw new Error(`Campaign not found or missing account_id: ${campError?.message}`);
  }
  if (campaign.deleted_at) {
    throw new Error(`Campaign ${campaignId} has been deleted`);
  }

  const rows = leadIds.map((leadId, i) => ({
    campaign_id: campaignId,
    account_id: campaign.account_id,
    lead_id: leadId,
    current_node_id: null,
    state: enrollmentStates?.[i] ?? 'active',
    next_run_at: new Date().toISOString(),
    flow_position: {},
    deleted_at: null,
  }));

  const { error } = await supabase
    .from('enrollments')
    .upsert(rows as any, {
      onConflict: 'campaign_id,lead_id',
      ignoreDuplicates: enrollmentStates === undefined,
    });

  if (error) throw new Error(`Failed to ensure campaign enrollments: ${error.message}`);
}

export async function backfillCampaignEnrollments(campaignId: string): Promise<void> {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);

  if (error) throw new Error(`Failed to load campaign leads for enrollment backfill: ${error.message}`);
  const leadIds = (leads || []).map((lead: any) => lead.id).filter(Boolean);
  await ensureCampaignEnrollmentsForLeads(campaignId, leadIds);
}

export async function cancelUnsentCampaignJobs(
  campaignId: string,
  reason: string = 'Campaign paused'
): Promise<number> {
  const { data, error } = await supabase.rpc('cancel_unsent_campaign_jobs', {
    p_campaign_id: campaignId,
    p_reason: reason,
  });

  if (error) throw new Error(`Failed to cancel unsent campaign jobs: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}
