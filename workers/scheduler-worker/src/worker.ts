import { SupabaseClient } from '@supabase/supabase-js';
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
}

/**
 * Scheduler Worker - continuously polls database and processes enrollments
 */
export class SchedulerWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private running: boolean = false;
  private mailboxRotationIndex: number = 0; // For round-robin mailbox selection

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
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
          console.log(`[SCHEDULER] Found ${enrollments.length} enrollment(s) ready to process`);
          enrollments.forEach(e => {
            console.log(`[SCHEDULER] Enrollment: ${e.id} | State: ${e.state} | Current Node: ${e.current_node_id?.substring(0, 8) || 'null'} | Next Run: ${e.next_run_at}`);
          });

          // Process enrollments in parallel (with concurrency limit if needed)
          const results = await Promise.allSettled(
            enrollments.map(enrollment => this.processEnrollment(enrollment))
          );
          
          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SCHEDULER] Processed ${enrollments.length} enrollment(s): ${successful} successful, ${failed} failed`);
          
          // Log any failures
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[SCHEDULER] Failed to process enrollment ${enrollments[index].id}:`, result.reason);
            }
          });
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
    const enrollmentId = enrollment.id.substring(0, 8);
    console.log(`[ENROLLMENT ${enrollment.id}] Starting processing... (state: ${enrollment.state}, current_node: ${enrollment.current_node_id?.substring(0, 8) || 'null'})`);
    
    try {
      // 1. Load campaign and flow graph (including account_id and jitter_percentage)
      console.log(`[ENROLLMENT ${enrollmentId}] Loading campaign ${enrollment.campaign_id.substring(0, 8)}...`);
      const { data: campaign, error: campaignError } = await this.supabase
        .from('campaigns')
        .select('flow_data, schedule, owner_id, account_id, jitter_percentage')
        .eq('id', enrollment.campaign_id)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${enrollment.campaign_id} not found: ${campaignError?.message}`);
      }
      console.log(`[ENROLLMENT ${enrollmentId}] Campaign loaded. Account ID: ${campaign.account_id?.substring(0, 8) || 'MISSING'}`);

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
      console.log(`[ENROLLMENT ${enrollmentId}] Evaluating flow. Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null (entry point)'}`);
      const nextNodes = await evaluateFlow(
        enrollment,
        enrollment.campaign_id,
        campaign.flow_data,
        this.supabase
      );
      
      console.log(`[ENROLLMENT ${enrollmentId}] Flow evaluation complete. Found ${nextNodes.length} next node(s)`);
      if (nextNodes.length > 0) {
        console.log(`[ENROLLMENT ${enrollmentId}] Next nodes: ${nextNodes.map(n => `${n.node_type}(${n.id.substring(0, 8)})`).join(', ')}`);
      }
      
      if (nextNodes.length === 0) {
        // No next nodes - mark enrollment as completed
        console.log(`[ENROLLMENT ${enrollmentId}] No next nodes found. Marking enrollment as completed.`);
        await this.supabase
          .from('enrollments')
          .update({ state: 'completed' })
          .eq('id', enrollment.id);
        return;
      }

      // 4. Process each next node
      console.log(`[ENROLLMENT ${enrollmentId}] Processing ${nextNodes.length} node(s)...`);
      for (const node of nextNodes) {
        console.log(`[ENROLLMENT ${enrollmentId}] Processing node: ${node.node_type} (${node.id.substring(0, 8)})`);
        
        if (node.node_type === 'email') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling email node...`);
          // Create message_job (send workers will poll database directly)
          const messageJob = await handleEmailNode(
            enrollment,
            node,
            campaign,
            this.mailboxRotationIndex,
            jitterPercentage,
            this.supabase
          );
          
          console.log(`[ENROLLMENT ${enrollmentId}] Email node processed. Message job created: ${messageJob.id.substring(0, 8)}`);
          
          // Update enrollment.current_node_id
          await this.supabase
            .from('enrollments')
            .update({ current_node_id: node.id })
            .eq('id', enrollment.id);
          
          console.log(`[ENROLLMENT ${enrollmentId}] Updated current_node_id to ${node.id.substring(0, 8)}`);
          
          // Increment mailbox rotation index for next enrollment
          this.mailboxRotationIndex++;
          
        } else if (node.node_type === 'waitTime' || node.node_type === 'wait') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling waitTime node...`);
          // Handle waitTime node with schedule (NO JITTER - wait times should be exact)
          await handleWaitTimeNode(
            enrollment,
            node,
            campaign.schedule,
            this.supabase
          );
          console.log(`[ENROLLMENT ${enrollmentId}] WaitTime node processed. Updated next_run_at.`);
        } else if (node.node_type === 'aiCategorizer') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling AICategorizer node...`);
          // Handle AICategorizer node (branching logic)
          const selectedFlowNodeId = await handleAICategorizerNode(
            enrollment,
            node,
            campaign.flow_data,
            this.supabase
          );
          console.log(`[ENROLLMENT ${enrollmentId}] AICategorizer selected flow node: ${selectedFlowNodeId || 'none'}`);

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
          console.log(`[ENROLLMENT ${enrollmentId}] Handling DataSender node...`);
          // Handle DataSender node (placeholder)
          await handleDataSenderNode(enrollment, node, this.supabase);
          console.log(`[ENROLLMENT ${enrollmentId}] DataSender node processed.`);
        } else if (node.node_type === 'leadSource') {
          // LeadSource is an entry point, not a traversal node
          // If we encounter it during traversal, mark flow as complete (cycle detected)
          console.warn(`[ENROLLMENT ${enrollmentId}] LeadSource node encountered during traversal - marking as completed`);
          await this.supabase
            .from('enrollments')
            .update({ state: 'completed' })
            .eq('id', enrollment.id);
        } else {
          // Handle other node types (unknown types)
          console.warn(`[ENROLLMENT ${enrollmentId}] Unknown node type '${node.node_type}'. Updating current_node_id and continuing.`);
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

