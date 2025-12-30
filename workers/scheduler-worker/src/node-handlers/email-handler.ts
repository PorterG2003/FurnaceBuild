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
  supabase: SupabaseClient,
  sqs: SQSClient,
  sendQueueUrl: string
): Promise<MessageJob> {
  // 1. Calculate scheduled_at (respects campaign schedule, jitter, etc.)
  const scheduledAt = calculateScheduledAt(enrollment, campaign.schedule);
  
  // 2. Load lead data (for template variables later)
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .single();
  
  if (leadError || !lead) {
    throw new Error(`Lead ${enrollment.lead_id} not found: ${leadError?.message}`);
  }
  
  // 3. Select mailbox (load balancing logic)
  const mailbox = await selectMailbox(enrollment.campaign_id, supabase);
  
  if (!mailbox) {
    throw new Error('No available mailbox found for campaign');
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
        node_config: node.data || {},
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
}

