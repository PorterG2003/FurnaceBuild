import { SupabaseClient } from '@supabase/supabase-js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Enrollment, MessageJob, Lead, Mailbox } from '../types.js';
import { calculateScheduledAt } from '../scheduling.js';
import { selectMailbox } from '../mailbox-selection.js';

// Note: rotationIndex will be passed from worker in Phase 3.1

/**
 * Handle email node: create message_job and push to SQS
 * Migrated from Lambda handler
 */
export async function handleEmailNode(
  enrollment: Enrollment,
  node: any,
  campaign: any,
  accountId: string,
  rotationIndex: number,
  jitterPercentage: number,
  supabase: SupabaseClient,
  sqs: SQSClient,
  sendQueueUrl: string
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
  
  // 5. Push to SQS
  try {
    const sqsResponse = await sqs.send(new SendMessageCommand({
      QueueUrl: sendQueueUrl,
      MessageBody: JSON.stringify({
        message_job_id: messageJob.id,
        enrollment_id: enrollment.id,
        campaign_id: enrollment.campaign_id,
      }),
    }));

    // 6. Update message_job with SQS message ID for tracking
    await supabase
      .from('message_jobs')
      .update({ sqs_message_id: sqsResponse.MessageId })
      .eq('id', messageJob.id);

    return messageJob as MessageJob;
  } catch (sqsError) {
    const errorMessage = sqsError instanceof Error ? sqsError.message : String(sqsError);
    console.error(`Failed to send message to SQS for message_job ${messageJob.id}:`, errorMessage);
    // TODO: Send to Slack error reporting channel - SQS send failure (critical)
    
    // Try to update message_job status to failed
    try {
      await supabase
        .from('message_jobs')
        .update({
          status: 'failed',
          error_message: `SQS send failed: ${errorMessage}`,
        })
        .eq('id', messageJob.id);
    } catch (updateError) {
      console.error(`Failed to update message_job ${messageJob.id} after SQS error:`, updateError);
    }
    
    throw new Error(`SQS send failed: ${errorMessage}`);
  }
}
