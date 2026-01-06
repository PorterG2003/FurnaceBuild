import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, MessageJob, Lead, Mailbox, Campaign } from '../types.js';
import { selectMailbox } from '../mailbox-selection.js';

/**
 * Handle email node: create message_job using campaign intervals
 * 
 * This function:
 * 1. Assigns mailbox to lead (if needed)
 * 2. Calls atomic assign_message_job_to_interval function which:
 *    - Locks next available campaign interval
 *    - Checks if mailbox already has job in interval
 *    - Creates message_job if needed
 *    - Releases interval lock
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
    // NOTE: Must use .is() for NULL checks, not .eq() - .eq(null) converts to string "null" causing PostgreSQL errors
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({ mailbox_id: selectedMailbox.id })
      .eq('id', enrollment.lead_id)
      .is('mailbox_id', null) // Only update if still NULL (atomic check)
      .select()
      .single();

    if (updateError || !updatedLead) {
      // Another worker already assigned - reload lead to get assigned mailbox
      // Log the update error for debugging
      if (updateError) {
        console.error(`[MAILBOX ASSIGNMENT] Update failed for lead ${enrollment.lead_id}:`, updateError.message);
      }
      
      const { data: reloadedLead, error: reloadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', enrollment.lead_id)
        .single();

      if (reloadError) {
        console.error(`[MAILBOX ASSIGNMENT] Reload failed for lead ${enrollment.lead_id}:`, reloadError.message);
        throw new Error(`Failed to reload lead ${enrollment.lead_id} after race condition: ${reloadError.message}`);
      }

      if (!reloadedLead) {
        throw new Error(`Lead ${enrollment.lead_id} not found after race condition`);
      }

      if (!reloadedLead.mailbox_id) {
        // This shouldn't happen if the atomic update worked correctly
        // But if it does, we need to handle it
        console.error(`[MAILBOX ASSIGNMENT] Lead ${enrollment.lead_id} still has NULL mailbox_id after race condition. Update error: ${updateError?.message || 'No error'}`);
        throw new Error(`Failed to assign mailbox for lead ${enrollment.lead_id}: mailbox_id is still NULL after race condition. This may indicate a database consistency issue.`);
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

  // 3. Atomically assign message_job to interval
  // This function: locks interval, checks mailbox, creates job, releases lock
  // All in a single atomic transaction
  const workerId = process.env.WORKER_ID || 'scheduler';
  const { data: result, error: assignError } = await supabase
    .rpc('assign_message_job_to_interval', {
    p_enrollment_id: enrollment.id,
    p_campaign_id: enrollment.campaign_id,
    p_lead_id: enrollment.lead_id,
    p_mailbox_id: mailbox.id,
    p_node_id: node.id,
    p_message_data: {
      node_config: node.node_data || {},
      lead_data: {
        email: lead.email,
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        },
      },
      p_jitter_percentage: jitterPercentage,
      p_worker_id: workerId
    });

  if (assignError) {
    throw new Error(`Failed to assign message_job to interval: ${assignError.message}`);
  }

  if (!result || result.length === 0) {
    throw new Error(`No available intervals for campaign ${enrollment.campaign_id}. Interval maintenance may not be running.`);
  }

  const jobResult = result[0] as any;

  if (!jobResult.is_new_job) {
    console.log(`[MAILBOX ASSIGNMENT] Mailbox ${mailbox.id} already has job in interval ${jobResult.interval_id}. Using existing job.`);
  }

  // Extract message job (without is_new_job field)
  const messageJob: MessageJob = {
    id: jobResult.id,
    enrollment_id: jobResult.enrollment_id,
    campaign_id: jobResult.campaign_id,
    lead_id: jobResult.lead_id,
    mailbox_id: jobResult.mailbox_id,
    node_id: jobResult.node_id,
    interval_id: jobResult.interval_id,
    status: jobResult.status,
    scheduled_at: jobResult.scheduled_at,
    message_data: jobResult.message_data,
  };

  // 4. Message job created - send workers will poll database directly using claim_message_jobs_ready RPC function
  // No SQS push needed - jobs are polled directly from database
  
  return messageJob;
}
