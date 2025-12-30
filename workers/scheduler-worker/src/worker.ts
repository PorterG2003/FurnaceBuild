import { SupabaseClient } from '@supabase/supabase-js';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DatabaseClient } from './database.js';
import { evaluateFlow } from './flow-evaluation.js';
import { handleEmailNode } from './node-handlers/email-handler.js';
import { handleWaitTimeNode } from './node-handlers/wait-time-handler.js';
import { handleAICategorizerNode } from './node-handlers/ai-categorizer-handler.js';
import { handleDataSenderNode } from './node-handlers/data-sender-handler.js';
import type { Enrollment } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  sqs: SQSClient;
  sendQueueUrl: string;
}

/**
 * Scheduler Worker - continuously polls database and processes enrollments
 */
export class SchedulerWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private sqs: SQSClient;
  private sendQueueUrl: string;
  private running: boolean = false;
  private mailboxRotationIndex: number = 0; // For round-robin mailbox selection

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.sqs = config.sqs;
    this.sendQueueUrl = config.sendQueueUrl;
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    this.running = true;
    console.log('Scheduler worker started. Polling database...');

    while (this.running) {
      try {
        // Poll database for enrollments ready to process
        const enrollments = await this.databaseClient.poll();

        if (enrollments.length > 0) {
          console.log(`Found ${enrollments.length} enrollments ready to process`);

          // Process enrollments in parallel (with concurrency limit if needed)
          await Promise.all(
            enrollments.map(enrollment => this.processEnrollment(enrollment))
          );
        } else {
          // No enrollments ready - wait before next poll
          await this.sleep(this.databaseClient.getPollInterval());
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('Error in scheduler worker main loop:', errorMessage);
        if (errorStack) {
          console.error('Stack trace:', errorStack);
        }
        // TODO: Send to Slack error reporting channel - Worker main loop error (critical)
        // This indicates a fatal error that stopped the worker loop
        // Wait before retrying
        await this.sleep(5000);
      }
    }

    console.log('Scheduler worker stopped.');
  }

  /**
   * Stop the worker gracefully
   */
  stop(): void {
    console.log('Stopping scheduler worker...');
    this.running = false;
  }

  /**
   * Process a single enrollment: evaluate flow, create jobs, update state
   * Migrated from Lambda handler
   */
  private async processEnrollment(enrollment: Enrollment): Promise<void> {
    try {
      // 1. Load campaign and flow graph (including account_id and jitter_percentage)
      const { data: campaign, error: campaignError } = await this.supabase
        .from('campaigns')
        .select('flow_data, schedule, owner_id, account_id, jitter_percentage')
        .eq('id', enrollment.campaign_id)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${enrollment.campaign_id} not found: ${campaignError?.message}`);
      }

      // 2. Validate account_id exists
      if (!campaign.account_id) {
        throw new Error(`Campaign ${enrollment.campaign_id} has no account_id. Campaigns must be associated with an account.`);
      }

      // 2.5. Load account jitter configuration
      const { data: account, error: accountError } = await this.supabase
        .from('accounts')
        .select('jitter_percentage')
        .eq('id', campaign.account_id)
        .single();

      if (accountError) {
        console.warn(`Account ${campaign.account_id} not found for campaign ${enrollment.campaign_id}, using default jitter: ${accountError?.message}`);
        // TODO: Send to Slack error reporting channel - Missing account (warning, not critical)
      }

      // Determine jitter: campaign > account > default (10%)
      const jitterPercentage = campaign.jitter_percentage ?? 
                                account?.jitter_percentage ?? 
                                10.0; // Default 10%

      // 3. Evaluate flow - find next node(s) (loads from database)
      const nextNodes = await evaluateFlow(
        enrollment,
        enrollment.campaign_id,
        campaign.flow_data,
        this.supabase
      );
      
      if (nextNodes.length === 0) {
        // No next nodes - mark enrollment as completed
        await this.supabase
          .from('enrollments')
          .update({ state: 'completed' })
          .eq('id', enrollment.id);
        return;
      }

      // 4. Process each next node
      for (const node of nextNodes) {
        if (node.node_type === 'email') {
          // Create message_job and push to SQS
          await handleEmailNode(
            enrollment,
            node,
            campaign,
            campaign.account_id,
            this.mailboxRotationIndex,
            jitterPercentage,
            this.supabase,
            this.sqs,
            this.sendQueueUrl
          );
          
          // Update enrollment.current_node_id
          await this.supabase
            .from('enrollments')
            .update({ current_node_id: node.id })
            .eq('id', enrollment.id);
          
          // Increment mailbox rotation index for next enrollment
          this.mailboxRotationIndex++;
          
        } else if (node.node_type === 'waitTime' || node.node_type === 'wait') {
          // Handle waitTime node with schedule (NO JITTER - wait times should be exact)
          await handleWaitTimeNode(
            enrollment,
            node,
            campaign.schedule,
            this.supabase
          );
        } else if (node.node_type === 'aiCategorizer') {
          // Handle AICategorizer node (branching logic)
          const selectedFlowNodeId = await handleAICategorizerNode(
            enrollment,
            node,
            campaign.flow_data,
            this.supabase
          );

          if (selectedFlowNodeId) {
            // Load the selected node from database
            const { data: selectedNode, error: selectedNodeError } = await this.supabase
              .from('nodes')
              .select('*')
              .eq('campaign_id', enrollment.campaign_id)
              .eq('flow_node_id', selectedFlowNodeId)
              .single();

            if (selectedNodeError || !selectedNode) {
              console.error(`Selected node ${selectedFlowNodeId} not found: ${selectedNodeError?.message}`);
              // Update enrollment to AICategorizer node and set next_run_at for retry
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: node.id,
                  next_run_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
                })
                .eq('id', enrollment.id);
            } else {
              // Update enrollment to AICategorizer node, then process the selected node
              await this.supabase
                .from('enrollments')
                .update({ current_node_id: node.id })
                .eq('id', enrollment.id);

              // Set next_run_at to process the selected node immediately
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: selectedNode.id,
                  next_run_at: new Date().toISOString(),
                })
                .eq('id', enrollment.id);
            }
          } else {
            // No category selected, update enrollment and set next_run_at for retry
            await this.supabase
              .from('enrollments')
              .update({
                current_node_id: node.id,
                next_run_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
              })
              .eq('id', enrollment.id);
          }
        } else if (node.node_type === 'dataSender') {
          // Handle DataSender node (placeholder)
          await handleDataSenderNode(enrollment, node, this.supabase);
        } else if (node.node_type === 'leadSource') {
          // LeadSource is an entry point, not a traversal node
          // If we encounter it during traversal, mark flow as complete (cycle detected)
          console.warn(`LeadSource node encountered during traversal for enrollment ${enrollment.id} - marking as completed`);
          await this.supabase
            .from('enrollments')
            .update({ state: 'completed' })
            .eq('id', enrollment.id);
        } else {
          // Handle other node types (unknown types)
          // For now, just update current_node_id and set next_run_at to process immediately
          await this.supabase
            .from('enrollments')
            .update({
              current_node_id: node.id,
              next_run_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error(`Error processing enrollment ${enrollment.id}:`, errorMessage);
      if (errorStack) {
        console.error('Stack trace:', errorStack);
      }

      // TODO: Send error to Slack error reporting channel
      // - Include: enrollment_id, campaign_id, error message, stack trace
      // - Categorize errors (critical vs. recoverable)
      // - Rate limit to avoid spam

      // Try to update enrollment state to indicate error (don't fail if this fails)
      try {
        await this.supabase
          .from('enrollments')
          .update({
            state: 'stopped', // Stop enrollment on error to prevent infinite retries
            next_run_at: new Date(Date.now() + 3600000).toISOString(), // Retry in 1 hour
          })
          .eq('id', enrollment.id);
      } catch (updateError) {
        console.error(`Failed to update enrollment ${enrollment.id} after error:`, updateError);
      }

      // Continue with next enrollment (don't stop worker)
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

