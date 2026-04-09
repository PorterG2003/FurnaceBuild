import { SupabaseClient } from '@supabase/supabase-js';
import { formatUnknownError, reportErrorToSlack } from '@furnace/slack-lib';
import { DatabaseClient } from './database.js';
import { evaluateFlow } from './flow-evaluation.js';
import { handleWaitTimeNode } from './node-handlers/wait-time-handler.js';
import { handleAICategorizerNode } from './node-handlers/ai-categorizer-handler.js';
import { handleDataSenderNode } from './node-handlers/data-sender-handler.js';
import { maintainCampaignIntervals } from './interval-management.js';
import { batchAssignIntervalJobs } from './batch-interval-assignment.js';
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
  private intervalMaintenanceTimer?: ReturnType<typeof setInterval>;
  private staleLockCleanupTimer?: ReturnType<typeof setInterval>;
  private processedIntervalCheckTimer?: ReturnType<typeof setInterval>;
  private batchIntervalAssignmentTimer?: ReturnType<typeof setInterval>;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    this.running = true;
    console.log('Scheduler worker starting...');

    // Start interval maintenance (runs every minute)
    this.startIntervalMaintenance();
    
    // Start stale lock cleanup (runs every 5 minutes)
    this.startStaleLockCleanup();
    
    // Start processed interval check (runs every minute)
    this.startProcessedIntervalCheck();
    
    // Start batch interval assignment (runs every 30 seconds)
    this.startBatchIntervalAssignment();

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

          // Log mailbox distribution before processing
          await this.logMailboxDistribution(enrollments);

          // Process enrollments in parallel (with concurrency limit if needed)
          // Pass rotationIndex based on batch index to ensure proper distribution even with parallel processing
          const results = await Promise.allSettled(
            enrollments.map((enrollment, index) => {
              // Calculate rotationIndex based on batch index to ensure proper round-robin even with parallel processing
              // Use current mailboxRotationIndex as base, then increment for each enrollment in batch
              const rotationIndex = this.mailboxRotationIndex + index;
              return this.processEnrollment(enrollment, rotationIndex);
            })
          );
          
          // Update mailboxRotationIndex after processing batch
          // Increment by number of enrollments processed (even if some failed, we want consistent rotation)
          this.mailboxRotationIndex += enrollments.length;
          
          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SCHEDULER] Processed ${enrollments.length} enrollment(s): ${successful} successful, ${failed} failed`);
          
          // Log mailbox distribution after processing
          await this.logMailboxDistributionAfterProcessing(enrollments, results);
          
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
        const errorMessage = formatUnknownError(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('Error in scheduler worker main loop:', errorMessage);
        if (errorStack) {
          console.error('Stack trace:', errorStack);
        }
        reportErrorToSlack('Scheduler worker main loop error (fatal)', {
          severity: 'critical',
          error: errorMessage,
        });
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
    
    if (this.intervalMaintenanceTimer) {
      clearInterval(this.intervalMaintenanceTimer);
    }
    if (this.staleLockCleanupTimer) {
      clearInterval(this.staleLockCleanupTimer);
    }
    if (this.processedIntervalCheckTimer) {
      clearInterval(this.processedIntervalCheckTimer);
    }
    if (this.batchIntervalAssignmentTimer) {
      clearInterval(this.batchIntervalAssignmentTimer);
    }
  }

  /**
   * Start interval maintenance background task
   */
  private startIntervalMaintenance(): void {
    // Run immediately, then every minute
    maintainCampaignIntervals(this.supabase).catch(err => {
      console.error('[INTERVAL MAINTENANCE] Error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      reportErrorToSlack('Scheduler: interval maintenance failed', { severity: 'warning', error: msg });
    });

    this.intervalMaintenanceTimer = setInterval(() => {
      maintainCampaignIntervals(this.supabase).catch(err => {
        console.error('[INTERVAL MAINTENANCE] Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        reportErrorToSlack('Scheduler: interval maintenance failed', { severity: 'warning', error: msg });
      });
    }, 60000); // 1 minute
  }

  /**
   * Start stale lock cleanup background task
   */
  private startStaleLockCleanup(): void {
    // Run every 5 minutes
    this.staleLockCleanupTimer = setInterval(async () => {
      try {
        const { data, error } = await this.supabase.rpc('cleanup_stale_interval_locks', {
          p_lock_timeout_minutes: 5
        });
        
        if (error) {
          console.error('[STALE LOCK CLEANUP] Error:', error);
          reportErrorToSlack('Scheduler: stale lock cleanup RPC failed', {
            severity: 'warning',
            error: error.message,
          });
        } else if (data > 0) {
          console.log(`[STALE LOCK CLEANUP] Released ${data} stale locks`);
        }
      } catch (error) {
        console.error('[STALE LOCK CLEANUP] Error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        reportErrorToSlack('Scheduler: stale lock cleanup failed', { severity: 'warning', error: msg });
      }
    }, 300000); // 5 minutes
  }

  /**
   * Start processed interval check background task
   */
  private startProcessedIntervalCheck(): void {
    // Run every minute to check for completed intervals
    this.processedIntervalCheckTimer = setInterval(async () => {
      try {
        const { data, error } = await this.supabase.rpc('check_and_update_processed_intervals', {
          p_campaign_id: null // Check all campaigns
        });
        
        if (error) {
          console.error('[PROCESSED INTERVAL CHECK] Error:', error);
          reportErrorToSlack('Scheduler: processed interval check RPC failed', {
            severity: 'warning',
            error: error.message,
          });
        } else if (data > 0) {
          console.log(`[PROCESSED INTERVAL CHECK] Updated ${data} processed interval(s)`);
        }
      } catch (error) {
        console.error('[PROCESSED INTERVAL CHECK] Error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        reportErrorToSlack('Scheduler: processed interval check failed', { severity: 'warning', error: msg });
      }
    }, 60000); // 1 minute
  }

  /**
   * Start batch interval assignment background task
   */
  private startBatchIntervalAssignment(): void {
    // Run immediately, then every 30 seconds
    batchAssignIntervalJobs(this.supabase, this.mailboxRotationIndex).catch(err => {
      console.error('[BATCH INTERVAL] Error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      reportErrorToSlack('Scheduler: batch interval assignment failed', { severity: 'critical', error: msg });
    });

    this.batchIntervalAssignmentTimer = setInterval(() => {
      batchAssignIntervalJobs(this.supabase, this.mailboxRotationIndex).catch(err => {
        console.error('[BATCH INTERVAL] Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        reportErrorToSlack('Scheduler: batch interval assignment failed', { severity: 'critical', error: msg });
      });
    }, 30000); // 30 seconds
  }

  /**
   * Log mailbox distribution before processing enrollments
   */
  private async logMailboxDistribution(enrollments: Enrollment[]): Promise<void> {
    if (enrollments.length === 0) return;

    // Group enrollments by campaign (most will be same campaign)
    const campaignGroups = new Map<string, Enrollment[]>();
    for (const enrollment of enrollments) {
      const existing = campaignGroups.get(enrollment.campaign_id) || [];
      existing.push(enrollment);
      campaignGroups.set(enrollment.campaign_id, existing);
    }

    for (const [campaignId, campaignEnrollments] of campaignGroups.entries()) {
      // Get leads for these enrollments to check mailbox assignments
      const leadIds = campaignEnrollments.map(e => e.lead_id);
      const { data: leads } = await this.supabase
        .from('leads')
        .select('id, mailbox_id, deleted_at')
        .in('id', leadIds);

      // Get eligible mailboxes for this campaign
      const { data: campaignMailboxes } = await this.supabase
        .from('campaign_mailboxes')
        .select(`
          mailbox_id,
          mailbox:mailboxes!inner(id, status, smtp_status, deleted_at)
        `)
        .eq('campaign_id', campaignId);

      const eligibleMailboxes = campaignMailboxes?.filter((cm: any) => 
        !cm.mailbox?.deleted_at && cm.mailbox?.status === 'connected' && cm.mailbox?.smtp_status === 'active'
      ) || [];

      // Count enrollments per mailbox (existing assignments)
      const mailboxCounts = new Map<string, number>();
      let unassignedCount = 0;

      for (const enrollment of campaignEnrollments) {
        const lead = leads?.find(l => l.id === enrollment.lead_id);
        if (lead?.deleted_at) {
          unassignedCount++;
        } else if (lead?.mailbox_id) {
          mailboxCounts.set(lead.mailbox_id, (mailboxCounts.get(lead.mailbox_id) || 0) + 1);
        } else {
          unassignedCount++;
        }
      }

      console.log(`[MAILBOX DIST] Campaign ${campaignId.substring(0, 8)}: ${campaignEnrollments.length} enrollment(s) ready`);
      console.log(`[MAILBOX DIST] Eligible mailboxes: ${eligibleMailboxes.length}`);
      console.log(`[MAILBOX DIST] Enrollments with assigned mailbox: ${campaignEnrollments.length - unassignedCount}, unassigned (will use round-robin): ${unassignedCount}`);
      
      // Show distribution
      const distribution: string[] = [];
      for (const cm of eligibleMailboxes) {
        const mailboxId = (cm as any).mailbox?.id || (cm as any).mailbox_id;
        if (mailboxId) {
          const count = mailboxCounts.get(mailboxId) || 0;
          distribution.push(`${mailboxId.substring(0, 8)}:${count}`);
        }
      }
      if (unassignedCount > 0) {
        distribution.push(`unassigned:${unassignedCount}`);
      }
      console.log(`[MAILBOX DIST] Distribution: ${distribution.join(', ')}`);
    }
  }

  /**
   * Log mailbox distribution after processing enrollments
   */
  private async logMailboxDistributionAfterProcessing(
    enrollments: Enrollment[],
    results: PromiseSettledResult<void>[]
  ): Promise<void> {
    if (enrollments.length === 0) return;

    // Group by campaign (with original indices for results mapping)
    const campaignGroups = new Map<string, { enrollment: Enrollment; originalIndex: number }[]>();
    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      const existing = campaignGroups.get(enrollment.campaign_id) || [];
      existing.push({ enrollment, originalIndex: i });
      campaignGroups.set(enrollment.campaign_id, existing);
    }

    for (const [campaignId, campaignEnrollmentsWithIndex] of campaignGroups.entries()) {
      const campaignEnrollments = campaignEnrollmentsWithIndex.map(item => item.enrollment);
      
      // Get leads to see final mailbox assignments (after processing)
      const leadIds = campaignEnrollments.map(e => e.lead_id);
      const { data: leads } = await this.supabase
        .from('leads')
        .select('id, mailbox_id, deleted_at')
        .in('id', leadIds);

      // Count successful vs failed (using original indices)
      const successfulEnrollments: Enrollment[] = [];
      const failedEnrollments: Enrollment[] = [];
      
      campaignEnrollmentsWithIndex.forEach(({ enrollment, originalIndex }) => {
        const result = results[originalIndex];
        if (result.status === 'fulfilled') {
          successfulEnrollments.push(enrollment);
        } else {
          failedEnrollments.push(enrollment);
        }
      });

      // Count final mailbox distribution for successful enrollments
      const mailboxCounts = new Map<string, number>();
      for (const enrollment of successfulEnrollments) {
        const lead = leads?.find(l => l.id === enrollment.lead_id);
        if (lead?.deleted_at) {
          continue;
        }
        if (lead?.mailbox_id) {
          mailboxCounts.set(lead.mailbox_id, (mailboxCounts.get(lead.mailbox_id) || 0) + 1);
        }
      }

      const distribution: string[] = [];
      mailboxCounts.forEach((count, mailboxId) => {
        distribution.push(`${mailboxId.substring(0, 8)}:${count}`);
      });
      
      console.log(`[MAILBOX DIST] After processing: ${successfulEnrollments.length} successful, ${failedEnrollments.length} failed`);
      if (distribution.length > 0) {
        console.log(`[MAILBOX DIST] Final distribution: ${distribution.join(', ')}`);
      }
    }
  }

  /**
   * Process a single enrollment: evaluate flow, create jobs, update state
   * Migrated from Lambda handler
   * 
   * @param enrollment - Enrollment to process
   * @param rotationIndex - Rotation index for mailbox selection (passed from batch processing)
   */
  private async processEnrollment(enrollment: Enrollment, rotationIndex: number): Promise<void> {
    const enrollmentId = enrollment.id.substring(0, 8);
    console.log(`[ENROLLMENT ${enrollment.id}] Starting processing... (state: ${enrollment.state}, current_node: ${enrollment.current_node_id?.substring(0, 8) || 'null'})`);
    
    try {
      // 1. Load campaign and flow graph (including account_id and jitter_percentage)
      console.log(`[ENROLLMENT ${enrollmentId}] Loading campaign ${enrollment.campaign_id.substring(0, 8)}...`);
      const { data: campaign, error: campaignError } = await this.supabase
        .from('campaigns')
        .select('id, flow_data, schedule, owner_id, account_id, jitter_percentage, sending_interval_seconds, created_at, status, deleted_at')
        .eq('id', enrollment.campaign_id)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${enrollment.campaign_id} not found: ${campaignError?.message}`);
      }
      console.log(`[ENROLLMENT ${enrollmentId}] Campaign loaded. Account ID: ${campaign.account_id?.substring(0, 8) || 'MISSING'}`);

      if (campaign.deleted_at) {
        console.log(`[ENROLLMENT ${enrollmentId}] Campaign ${enrollment.campaign_id.substring(0, 8)} has been deleted. Stopping enrollment.`);
        await this.supabase
          .from('enrollments')
          .update({
            deleted_at: new Date().toISOString(),
            state: 'stopped',
            next_run_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id);
        return;
      }

      if (campaign.status !== 'running') {
        console.log(`[ENROLLMENT ${enrollmentId}] Campaign status is '${campaign.status}'. Skipping processing until campaign is running.`);
        await this.supabase
          .from('enrollments')
          .update({ next_run_at: new Date().toISOString() })
          .eq('id', enrollment.id)
          .eq('state', 'active');
        return;
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
        reportErrorToSlack('Missing account for campaign (using default jitter)', {
          severity: 'warning',
          campaign_id: enrollment.campaign_id,
          account_id: campaign.account_id,
        });
      }

      // Determine jitter: campaign > account > default (10%)
      const jitterPercentage = campaign.jitter_percentage ?? 
                                account?.jitter_percentage ?? 
                                10.0; // Default 10%

      // 3. Evaluate flow - find next node(s) (loads from database)
      console.log(`[ENROLLMENT ${enrollmentId}] Evaluating flow. Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null (entry point)'}`);
      const evaluationResult = await evaluateFlow(
        enrollment,
        enrollment.campaign_id,
        campaign.flow_data,
        this.supabase
      );
      
      const nextNodes = evaluationResult.nodes;
      console.log(`[ENROLLMENT ${enrollmentId}] Flow evaluation complete. Found ${nextNodes.length} next node(s)`);
      if (nextNodes.length > 0) {
        console.log(`[ENROLLMENT ${enrollmentId}] Next nodes: ${nextNodes.map(n => `${n.node_type}(${n.id.substring(0, 8)})`).join(', ')}`);
      }
      
      if (nextNodes.length === 0) {
        // No next nodes - check if this is because we're waiting for email to be sent
        if (evaluationResult.waitingForEmail) {
          // Waiting for email to be sent - don't mark as completed
          // Send worker will update next_run_at when email is sent, triggering re-evaluation
          console.log(`[ENROLLMENT ${enrollmentId}] No next nodes, but waiting for email to be sent. Will re-evaluate when email is sent.`);
          return;
        }
        
        // No next nodes and not waiting for email - flow is complete
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
          // Email node: just set current_node_id and stop
          // Job creation will be handled by batch interval assignment process
          await this.supabase
            .from('enrollments')
            .update({ current_node_id: node.id })
            .eq('id', enrollment.id);
          
          console.log(`[ENROLLMENT ${enrollmentId}] Email node reached. Updated current_node_id to ${node.id.substring(0, 8)}. Job will be created by batch process.`);
          
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
              .is('deleted_at', null)
              .single();

            if (selectedNodeError || !selectedNode) {
              const errMsg = selectedNodeError?.message ?? 'Node not found';
              console.error(`Selected node ${selectedFlowNodeId} not found: ${errMsg}`);
              reportErrorToSlack('Scheduler: selected node not found (flow inconsistency)', {
                severity: 'warning',
                enrollment_id: enrollment.id,
                flow_node_id: selectedFlowNodeId,
                error: errMsg,
              });
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
      // Check if this is a normal deferral (e.g., no intervals available)
      // These are expected and handled gracefully - don't log as errors
      const isDeferral = (error as any)?.isDeferral === true;
      
      if (isDeferral) {
        // Normal deferral - enrollment already updated; continue without logging
        return;
      }

      // Real error - log and handle
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error(`Error processing enrollment ${enrollment.id}:`, errorMessage);
      if (errorStack) {
        console.error('Stack trace:', errorStack);
      }

      // Store a short clue for the UI (what/where/why); max 500 chars, single line
      const stoppedErrorMessage = errorMessage.replace(/\s+/g, ' ').trim().slice(0, 500) || null;

      reportErrorToSlack('Enrollment processing error', {
        severity: 'critical',
        enrollment_id: enrollment.id,
        campaign_id: enrollment.campaign_id,
        error: errorMessage,
      });

      // Try to update enrollment state to indicate error (don't fail if this fails)
      try {
        const stoppedAt = new Date().toISOString();
        // Fatal error: stop enrollment to prevent infinite retries
        await this.supabase
          .from('enrollments')
          .update({
            state: 'stopped', // Stop enrollment on error to prevent infinite retries
            stopped_reason: 'error',
            stopped_at: stoppedAt,
            stopped_error_message: stoppedErrorMessage,
            next_run_at: new Date(Date.now() + 3600000).toISOString(), // Retry in 1 hour
          })
          .eq('id', enrollment.id);
      } catch (updateError) {
        console.error(`Failed to update enrollment ${enrollment.id} after error:`, updateError);
        const updateMsg = updateError instanceof Error ? updateError.message : String(updateError);
        reportErrorToSlack('Scheduler: failed to update enrollment state after error', {
          severity: 'warning',
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          error: updateMsg,
        });
      }

      // Continue with next enrollment (don't stop worker)
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

