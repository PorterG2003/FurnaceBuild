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

export async function pauseCampaignAndDeferJobs(
  campaignId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('pause_campaign_and_defer_jobs', {
    p_campaign_id: campaignId,
  });

  if (error) throw new Error(`Failed to pause campaign: ${error.message}`);
  return typeof data === 'number' ? data : 0;
}

export interface ResumeCampaignResult {
  revived_jobs: number;
  rescheduled_jobs: number;
}

export interface StopCampaignResult {
  stopped_enrollments: number;
}

export async function resumeCampaignAndRescheduleJobs(
  campaignId: string,
  pauseReason: string = 'Campaign paused'
): Promise<ResumeCampaignResult> {
  const { data, error } = await supabase.rpc('resume_campaign_and_reschedule_jobs', {
    p_campaign_id: campaignId,
    p_pause_reason: pauseReason,
  });

  if (error) throw new Error(`Failed to resume campaign: ${error.message}`);

  const result = Array.isArray(data) ? data[0] : data;
  return {
    revived_jobs: typeof result?.revived_jobs === 'number' ? result.revived_jobs : 0,
    rescheduled_jobs: typeof result?.rescheduled_jobs === 'number' ? result.rescheduled_jobs : 0,
  };
}

export async function stopCampaignAndStopEnrollments(
  campaignId: string
): Promise<StopCampaignResult> {
  const { data, error } = await supabase.rpc('stop_campaign_and_stop_enrollments', {
    p_campaign_id: campaignId,
  });

  if (error) throw new Error(`Failed to stop campaign: ${error.message}`);

  return {
    stopped_enrollments: typeof data === 'number' ? data : 0,
  };
}
