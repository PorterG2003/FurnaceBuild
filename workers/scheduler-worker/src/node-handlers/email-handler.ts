import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, MessageJob, Lead, Mailbox, Campaign } from '../types.js';
import { calculateScheduledAt, calculateNextMailboxSendTime } from '../scheduling.js';
import { selectMailbox } from '../mailbox-selection.js';

/**
 * Handle email node: create message_job in database
 * 
 * This function:
 * 1. Checks if lead has mailbox assigned (for consistency)
 * 2. If not assigned, assigns mailbox via round-robin (atomic update)
 * 3. Calculates base time using slot-based interval calculation
 * 4. Creates message_job atomically using slot-based function
 */
export async function handleEmailNode(
  enrollment: Enrollment,
  node: any,
  campaign: Campaign,
  rotationIndex: number,
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<MessageJob> {
  // 1. Load lead data (includes mailbox_id for consistency check)
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  if (leadError || !lead) {
    const error = `Lead ${enrollment.lead_id} not found for enrollment ${enrollment.id}: ${leadError?.message || 'Lead not found'}`;
    console.error(error);
    throw new Error(error);
  }

  // 2. Determine mailbox assignment
  let mailbox: Mailbox;
  let isFirstEmail = false;

  if (!lead.mailbox_id) {
    // First email node - assign mailbox via round-robin
    isFirstEmail = true;
    
    // Check if any emails exist for this lead (handles branching scenario)
    const { data: existingJobs, error: checkError } = await supabase
      .from('message_jobs')
      .select('id')
      .eq('lead_id', enrollment.lead_id)
      .eq('campaign_id', enrollment.campaign_id)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      throw new Error(`Failed to check existing message jobs: ${checkError.message}`);
    }

    if (existingJobs) {
      // Emails exist but mailbox_id is NULL - inconsistency
      throw new Error(`Inconsistency detected: Lead ${enrollment.lead_id} has message jobs but mailbox_id is NULL`);
    }

    // Select mailbox via round-robin
    const selectedMailbox = await selectMailbox(enrollment.campaign_id, supabase, rotationIndex);
    
    if (!selectedMailbox) {
      const error = `No available mailbox found for campaign ${enrollment.campaign_id} (enrollment ${enrollment.id}). Campaign must have at least one mailbox assigned.`;
      console.error(error);
      throw new Error(error);
    }

    // Atomically assign mailbox to lead
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({ mailbox_id: selectedMailbox.id })
      .eq('id', enrollment.lead_id)
      .eq('mailbox_id', null) // Only update if still NULL (atomic check)
      .select()
      .single();

    if (updateError || !updatedLead) {
      // Another worker already assigned - reload lead to get assigned mailbox
      const { data: reloadedLead, error: reloadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', enrollment.lead_id)
        .single();

      if (reloadError || !reloadedLead || !reloadedLead.mailbox_id) {
        throw new Error(`Failed to assign or retrieve mailbox for lead ${enrollment.lead_id}: ${updateError?.message || reloadError?.message}`);
      }

      // Get the assigned mailbox
      const { data: assignedMailbox, error: mailboxError } = await supabase
        .from('mailboxes')
        .select('*')
        .eq('id', reloadedLead.mailbox_id)
        .single();

      if (mailboxError || !assignedMailbox) {
        throw new Error(`Assigned mailbox ${reloadedLead.mailbox_id} not found: ${mailboxError?.message}`);
      }

      mailbox = assignedMailbox as Mailbox;
      console.log(`[MAILBOX ASSIGNMENT] Lead ${enrollment.lead_id} already had mailbox ${mailbox.id} assigned (race condition handled)`);
    } else {
      mailbox = selectedMailbox;
      console.log(`[MAILBOX ASSIGNMENT] Assigned mailbox ${mailbox.id} to lead ${enrollment.lead_id} (first email)`);
    }
  } else {
    // Subsequent email node - use assigned mailbox
    // Validate mailbox is still assigned to campaign and available
    const { data: assignedMailbox, error: mailboxError } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('id', lead.mailbox_id)
      .single();

    if (mailboxError || !assignedMailbox) {
      throw new Error(`Assigned mailbox ${lead.mailbox_id} not found for lead ${enrollment.lead_id}: ${mailboxError?.message}`);
    }

    // Check mailbox is still assigned to campaign
    const { data: campaignMailbox, error: campaignMailboxError } = await supabase
      .from('campaign_mailboxes')
      .select('mailbox_id')
      .eq('campaign_id', enrollment.campaign_id)
      .eq('mailbox_id', lead.mailbox_id)
      .maybeSingle();

    if (campaignMailboxError) {
      throw new Error(`Failed to verify mailbox assignment: ${campaignMailboxError.message}`);
    }

    if (!campaignMailbox) {
      throw new Error(`Mailbox ${lead.mailbox_id} is no longer assigned to campaign ${enrollment.campaign_id} (lead ${enrollment.lead_id})`);
    }

    // Check mailbox is available
    if (assignedMailbox.status !== 'connected' || assignedMailbox.smtp_status !== 'active') {
      throw new Error(`Assigned mailbox ${lead.mailbox_id} is not available (status: ${assignedMailbox.status}, smtp_status: ${assignedMailbox.smtp_status})`);
    }

    mailbox = assignedMailbox as Mailbox;
    console.log(`[MAILBOX CONSISTENCY] Using assigned mailbox ${mailbox.id} for lead ${enrollment.lead_id} (subsequent email)`);
  }

  // 3. Calculate base time using slot-based interval calculation
  const currentTime = new Date();
  const baseTime = await calculateNextMailboxSendTime(
    enrollment.campaign_id,
    mailbox.id,
    currentTime,
    campaign.schedule,
    supabase
  );

  // 4. Calculate scheduled_at (applies schedule constraints and jitter)
  const scheduledAt = calculateScheduledAt(baseTime, campaign.schedule, jitterPercentage);

  // 5. Create message_job atomically using slot-based function
  const { data: result, error: jobError } = await supabase.rpc('create_message_job_if_slot_available', {
    p_enrollment_id: enrollment.id,
    p_campaign_id: enrollment.campaign_id,
    p_lead_id: enrollment.lead_id,
    p_mailbox_id: mailbox.id,
    p_node_id: node.id,
    p_scheduled_at: scheduledAt,
    p_message_data: {
      // Template data will be filled by send worker
      node_config: node.node_data || {},
      lead_data: {
        email: lead.email,
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        // Add other lead fields as needed
      },
    },
    p_campaign_interval_seconds: campaign.sending_interval_seconds,
  });

  if (jobError || !result || result.length === 0) {
    throw new Error(`Failed to create message_job: ${jobError?.message}`);
  }

  const messageJobResult = result[0] as any; // RPC function returns table with is_new_job field

  if (!messageJobResult.is_new_job) {
    // Slot was already taken - another enrollment scheduled at this slot
    // This is expected behavior - log for monitoring but don't error
    console.log(`[SLOT TAKEN] Mailbox ${mailbox.id} slot at ${messageJobResult.scheduled_at} already has a job. Using existing job.`);
  }

  // Extract message job (without is_new_job field) for return
  const messageJob: MessageJob = {
    id: messageJobResult.id,
    enrollment_id: messageJobResult.enrollment_id,
    campaign_id: messageJobResult.campaign_id,
    lead_id: messageJobResult.lead_id,
    mailbox_id: messageJobResult.mailbox_id,
    node_id: messageJobResult.node_id,
    status: messageJobResult.status,
    scheduled_at: messageJobResult.scheduled_at,
    message_data: messageJobResult.message_data,
  };

  // 6. Message job created - send workers will poll database directly using claim_message_jobs_ready RPC function
  // No SQS push needed - jobs are polled directly from database
  
  return messageJob;
}
