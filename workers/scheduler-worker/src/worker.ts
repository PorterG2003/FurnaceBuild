import { SupabaseClient } from '@supabase/supabase-js';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DatabaseClient } from './database.js';
import { evaluateFlow } from './flow-evaluation.js';
import { handleEmailNode } from './node-handlers/email-handler.js';
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
        console.error('Error in scheduler worker main loop:', error);
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
      // 1. Load campaign and flow graph
      const { data: campaign, error: campaignError } = await this.supabase
        .from('campaigns')
        .select('flow_data, schedule, owner_id')
        .eq('id', enrollment.campaign_id)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${enrollment.campaign_id} not found: ${campaignError?.message}`);
      }

      // 2. Evaluate flow - find next node(s)
      const nextNodes = evaluateFlow(enrollment, campaign.flow_data);
      
      if (nextNodes.length === 0) {
        // No next nodes - mark enrollment as completed
        await this.supabase
          .from('enrollments')
          .update({ state: 'completed' })
          .eq('id', enrollment.id);
        return;
      }

      // 3. Process each next node
      for (const node of nextNodes) {
        if (node.type === 'email') {
          // Create message_job and push to SQS
          await handleEmailNode(
            enrollment,
            node,
            campaign,
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
          
        } else if (node.type === 'waitTime' || node.type === 'wait') {
          // Update enrollment.next_run_at for wait nodes
          const waitDuration = node.data?.wait_duration_seconds || node.data?.duration_seconds || 0;
          const nextRunAt = new Date(Date.now() + waitDuration * 1000).toISOString();
          
          await this.supabase
            .from('enrollments')
            .update({
              next_run_at: nextRunAt,
              current_node_id: node.id,
            })
            .eq('id', enrollment.id);
        } else {
          // Handle other node types (branch, conditional, etc.)
          // For now, just update current_node_id
          await this.supabase
            .from('enrollments')
            .update({ current_node_id: node.id })
            .eq('id', enrollment.id);
        }
      }
    } catch (error) {
      console.error(`Error processing enrollment ${enrollment.id}:`, error);
      // Continue with next enrollment (don't stop worker)
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

