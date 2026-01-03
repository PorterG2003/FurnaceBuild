import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, MessageJob, Lead, Mailbox } from '../types.js';
import { calculateScheduledAt } from '../scheduling.js';
import { selectMailbox } from '../mailbox-selection.js';

// Note: rotationIndex will be passed from worker in Phase 3.1

/**
 * Handle email node: create message_job in database
 * Send workers will poll database directly using claim_message_jobs_ready RPC function
 */
export async function handleEmailNode(
  enrollment: Enrollment,
  node: any,
  campaign: any,
  accountId: string,
  rotationIndex: number,
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<MessageJob> {
  // 1. Calculate scheduled_at (respects campaign schedule, jitter, etc.)
  // Use current time as base, apply schedule and jitter
  const baseTime = new Date();
  const scheduledAt = calculateScheduledAt(baseTime, campaign.schedule, jitterPercentage);
  
  // 2. Load lead data (for template variables later)
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  if (leadError || !lead) {
    const error = `Lead ${enrollment.lead_id} not found for enrollment ${enrollment.id}: ${leadError?.message || 'Lead not found'}`;
    console.error(error);
    // TODO: Send to Slack error reporting channel - Missing lead data
    throw new Error(error);
  }
  
  // 3. Select mailbox using round-robin (load balancing)
  const mailbox = await selectMailbox(accountId, supabase, rotationIndex);
  
  if (!mailbox) {
    const error = `No available mailbox found for account ${accountId} (campaign ${enrollment.campaign_id}, enrollment ${enrollment.id})`;
    console.error(error);
    // TODO: Send to Slack error reporting channel - No mailboxes available (critical)
    throw new Error(error);
  }
  
  // 4. Create message_job
  const { data: messageJob, error: jobError } = await supabase
    .from('message_jobs')
    .insert({
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      lead_id: enrollment.lead_id,
      mailbox_id: mailbox.id,
      node_id: node.id,
      status: 'pending',
      scheduled_at: scheduledAt,
      message_data: {
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
    })
    .select()
    .single();
  
  if (jobError || !messageJob) {
    throw new Error(`Failed to create message_job: ${jobError?.message}`);
  }
  
  // 5. Message job created - send workers will poll database directly using claim_message_jobs_ready RPC function
  // No SQS push needed - jobs are polled directly from database
  
  return messageJob as MessageJob;
}
