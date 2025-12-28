import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { EventBridgeHandler } from 'aws-lambda';

// EventBridge scheduled event type
type SchedulerEvent = EventBridgeHandler<'Scheduled Event', null, void>;

interface Enrollment {
  id: string;
  campaign_id: string;
  lead_id: string;
  current_node_id: string;
  state: 'active' | 'paused' | 'stopped' | 'completed';
  next_run_at: string;
  flow_position: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * Scheduler Lambda Handler
 * 
 * This function runs periodically (triggered by EventBridge schedule)
 * to:
 * 1. Query enrollments that are ready to process (next_run_at <= NOW())
 * 2. For each enrollment, evaluate the campaign flow
 * 3. Create message_jobs for email nodes
 * 4. Push message_job IDs to SQS send_queue
 * 5. Update enrollment.next_run_at for wait/delay nodes
 */
export const handler: EventBridgeHandler<'Scheduled Event', null, void> = async (event) => {
  console.log('Scheduler triggered:', JSON.stringify(event, null, 2));

  // Initialize clients
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const sendQueueUrl = process.env.SEND_QUEUE_URL;
  // AWS_REGION is automatically set by Lambda runtime
  const awsRegion = process.env.AWS_REGION;

  if (!supabaseUrl || !supabaseServiceKey || !sendQueueUrl) {
    throw new Error('Missing required environment variables: EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, or SEND_QUEUE_URL');
  }

  if (!awsRegion) {
    throw new Error('AWS_REGION is not set in Lambda runtime environment');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const sqs = new SQSClient({ region: awsRegion });

  try {
    // Query enrollments ready to process
    const { data: enrollments, error: queryError } = await supabase
      .from('enrollments')
      .select('*')
      .eq('state', 'active')
      .lte('next_run_at', new Date().toISOString())
      .limit(50); // Process in smaller batches to finish within 60-second timeout

    if (queryError) {
      console.error('Error querying enrollments:', queryError);
      throw queryError;
    }

    console.log(`Found ${enrollments?.length || 0} enrollments ready to process`);

    if (!enrollments || enrollments.length === 0) {
      console.log('No enrollments ready to process');
      return;
    }

    // Process each enrollment
    const results = {
      processed: 0,
      errors: 0,
      messageJobsCreated: 0,
    };

    for (const enrollment of enrollments) {
      try {
        const result = await processEnrollment(enrollment, supabase, sqs, sendQueueUrl);
        results.processed++;
        if (result.messageJobsCreated > 0) {
          results.messageJobsCreated += result.messageJobsCreated;
        }
      } catch (error) {
        console.error(`Error processing enrollment ${enrollment.id}:`, error);
        results.errors++;
        // Continue with next enrollment
      }
    }

    console.log('Scheduler completed:', {
      ...results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Fatal error in scheduler:', error);
    throw error;
  }
};

/**
 * Process a single enrollment: evaluate flow, create jobs, update state
 */
async function processEnrollment(
  enrollment: Enrollment,
  supabase: SupabaseClient,
  sqs: SQSClient,
  sendQueueUrl: string
): Promise<{ messageJobsCreated: number }> {
  // 1. Load campaign and flow graph
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('flow_data, schedule')
    .eq('id', enrollment.campaign_id)
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Campaign ${enrollment.campaign_id} not found: ${campaignError?.message}`);
  }

  // 2. Evaluate flow - find next node(s)
  // TODO: Implement flow evaluation logic (Phase 2.2-9)
  const nextNodes = evaluateFlow(enrollment, campaign.flow_data);
  
  if (nextNodes.length === 0) {
    // No next nodes - mark enrollment as completed
    await supabase
      .from('enrollments')
      .update({ state: 'completed' })
      .eq('id', enrollment.id);
    return { messageJobsCreated: 0 };
  }

  let messageJobsCreated = 0;

  // 3. Process each next node
  for (const node of nextNodes) {
    if (node.type === 'email') {
      // Create message_job and push to SQS
      const messageJob = await createMessageJob(enrollment, node, supabase, campaign.schedule);
      
      // Push to SQS
      const sqsResponse = await sqs.send(new SendMessageCommand({
        QueueUrl: sendQueueUrl,
        MessageBody: JSON.stringify({
          message_job_id: messageJob.id,
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
        }),
      }));

      // Update message_job with SQS message ID for tracking
      await supabase
        .from('message_jobs')
        .update({ sqs_message_id: sqsResponse.MessageId })
        .eq('id', messageJob.id);

      messageJobsCreated++;
      
    } else if (node.type === 'waitTime' || node.type === 'wait') {
      // Update enrollment.next_run_at for wait nodes
      const waitDuration = node.data?.wait_duration_seconds || node.data?.duration_seconds || 0;
      const nextRunAt = new Date(Date.now() + waitDuration * 1000).toISOString();
      
      await supabase
        .from('enrollments')
        .update({
          next_run_at: nextRunAt,
          current_node_id: node.id,
        })
        .eq('id', enrollment.id);
    } else {
      // Handle other node types (branch, conditional, etc.)
      // For now, just update current_node_id
      await supabase
        .from('enrollments')
        .update({ current_node_id: node.id })
        .eq('id', enrollment.id);
    }
  }

  return { messageJobsCreated };
}

/**
 * Create a message_job for an email node
 */
async function createMessageJob(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  schedule: any
) {
  // 1. Calculate scheduled_at (respects campaign schedule, jitter, etc.)
  // TODO: Implement scheduling logic (Phase 2.2-11)
  const scheduledAt = calculateScheduledAt(enrollment, schedule);
  
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
  // TODO: Implement mailbox selection logic (Phase 2.2-10)
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
  
  return messageJob;
}

/**
 * Evaluate flow graph to find next node(s) from current position
 * TODO: Implement flow traversal logic (Phase 2.2-9)
 */
function evaluateFlow(enrollment: Enrollment, flowData: any): any[] {
  // Placeholder implementation
  // This should:
  // - Load flow edges from flowData
  // - Find next node(s) from enrollment.current_node_id
  // - Handle branching/conditionals
  // - Return array of next nodes to process
  
  if (!flowData || !flowData.nodes || !flowData.edges) {
    console.warn(`Invalid flow_data for enrollment ${enrollment.id}`);
    return [];
  }

  const nodes = flowData.nodes;
  const edges = flowData.edges || [];
  
  // Find edges starting from current_node_id
  const nextEdges = edges.filter((edge: any) => edge.source === enrollment.current_node_id);
  
  if (nextEdges.length === 0) {
    // No next edges - flow complete
    return [];
  }

  // Get target nodes
  const nextNodes = nextEdges
    .map((edge: any) => nodes.find((n: any) => n.id === edge.target))
    .filter((node: any) => node !== undefined);

  return nextNodes;
}

/**
 * Calculate when the message should be scheduled to send
 * TODO: Implement scheduling logic (Phase 2.2-11)
 */
function calculateScheduledAt(enrollment: Enrollment, schedule: any): string {
  // Placeholder implementation
  // This should:
  // - Respect campaign schedule (timezone, hours, days_of_week)
  // - Apply jitter (random delay)
  // - Handle business hours
  
  // For now, schedule immediately
  return new Date().toISOString();
}

/**
 * Select a mailbox for sending (load balancing)
 * TODO: Implement mailbox selection logic (Phase 2.2-10)
 */
async function selectMailbox(campaignId: string, supabase: SupabaseClient): Promise<any> {
  // Placeholder implementation
  // This should:
  // - Load available mailboxes for campaign/account
  // - Implement load balancing / round-robin
  // - Consider mailbox throttles
  
  const { data: mailboxes, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('smtp_status', 'active')
    .limit(1);
  
  if (error || !mailboxes || mailboxes.length === 0) {
    throw new Error(`No available mailboxes: ${error?.message}`);
  }
  
  return mailboxes[0];
}

