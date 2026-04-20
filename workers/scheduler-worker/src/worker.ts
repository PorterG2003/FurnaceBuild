import { SupabaseClient } from '@supabase/supabase-js';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  isTransientUpstreamGatewayErrorMessage,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { DatabaseClient } from './database.js';
import {
  evaluateFlow,
  type DatabaseNode,
  type FlowEvaluationSharedContext,
  type LatestMessageJobStatus,
} from './flow-evaluation.js';
import { handleWaitTimeNode } from './node-handlers/wait-time-handler.js';
import { handleAICategorizerNode } from './node-handlers/ai-categorizer-handler.js';
import { handleDataSenderNode } from './node-handlers/data-sender-handler.js';
import { maintainCampaignIntervals } from './interval-management.js';
import { batchAssignIntervalJobs } from './batch-interval-assignment.js';
import type { CampaignSchedule, Enrollment } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
}

type CampaignAccountRelation =
  | {
      jitter_percentage?: number | null;
    }
  | Array<{
      jitter_percentage?: number | null;
    }>
  | null;

type SchedulerCampaignRecord = {
  id: string;
  flow_data: {
    nodes: any[];
    edges: any[];
  };
  current_flow_version_number?: number | null;
  schedule: CampaignSchedule | null;
  owner_id: string;
  account_id: string | null;
  jitter_percentage?: number | null;
  sending_interval_seconds?: number | null;
  created_at: string;
  status: string;
  deleted_at?: string | null;
  accounts?: CampaignAccountRelation;
};

interface CampaignEnrollmentBatchItem {
  enrollment: Enrollment;
  originalIndex: number;
}

interface CampaignProcessingContext extends FlowEvaluationSharedContext {
  campaign: SchedulerCampaignRecord | null;
  jitterPercentage: number;
  accountMissingConfig: boolean;
}

const FULL_BATCH_BACKOFF_MS = 750;

function toRetryableReadInput(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    return {
      message: 'message' in error ? String((error as any).message ?? '') : undefined,
      code: 'code' in error ? String((error as any).code ?? '') : undefined,
      details: 'details' in error ? String((error as any).details ?? '') : undefined,
      hint: 'hint' in error ? String((error as any).hint ?? '') : undefined,
      status:
        typeof (error as any).status === 'number'
          ? (error as any).status
          : undefined,
      name: 'name' in error ? String((error as any).name ?? '') : undefined,
    };
  }

  return formatUnknownError(error);
}

function getAccountJitter(accounts: CampaignAccountRelation | undefined): number | null {
  if (Array.isArray(accounts)) {
    return accounts[0]?.jitter_percentage ?? null;
  }

  return accounts?.jitter_percentage ?? null;
}

/**
 * Scheduler Worker - continuously polls database and processes enrollments
 */
export class SchedulerWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private running: boolean = false;
  private mailboxRotationIndex: number = 0; // For round-robin mailbox selection
  private readonly mailboxDistributionDebugEnabled =
    process.env.SCHEDULER_LOG_MAILBOX_DISTRIBUTION === 'true';
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

          const campaignGroups = this.groupEnrollmentsByCampaign(enrollments);
          const campaignContexts = await this.loadCampaignContexts(campaignGroups);

          if (this.mailboxDistributionDebugEnabled) {
            await this.logMailboxDistribution(enrollments);
          }

          const results: PromiseSettledResult<void>[] = new Array(enrollments.length);
          const reportedMissingAccountWarnings = new Set<string>();

          await Promise.all(
            Array.from(campaignGroups.entries()).map(async ([campaignId, batchItems]) => {
              const context = campaignContexts.get(campaignId);

              if (
                context?.campaign?.account_id &&
                context.accountMissingConfig &&
                !reportedMissingAccountWarnings.has(campaignId)
              ) {
                reportedMissingAccountWarnings.add(campaignId);
                reportErrorToSlack('Missing account for campaign (using default jitter)', {
                  severity: 'warning',
                  campaign_id: campaignId,
                  account_id: context.campaign.account_id,
                  error: 'Account jitter configuration unavailable; using default jitter.',
                  alertPolicy: 'persistent_config_warning',
                  aggregationKey: `missing-account:${campaignId}:${context.campaign.account_id}`,
                  summaryFields: {
                    campaign_id: campaignId,
                    account_id: context.campaign.account_id,
                  },
                });
              }

              const groupResults = await Promise.allSettled(
                batchItems.map(({ enrollment }) => this.processEnrollment(enrollment, context))
              );

              groupResults.forEach((result, resultIndex) => {
                const originalIndex = batchItems[resultIndex]?.originalIndex;
                if (originalIndex !== undefined) {
                  results[originalIndex] = result;
                }
              });
            }),
          );
          
          // Update mailboxRotationIndex after processing batch
          // Increment by number of enrollments processed (even if some failed, we want consistent rotation)
          this.mailboxRotationIndex += enrollments.length;
          
          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SCHEDULER] Processed ${enrollments.length} enrollment(s): ${successful} successful, ${failed} failed`);
          
          // Log mailbox distribution after processing
          if (this.mailboxDistributionDebugEnabled) {
            await this.logMailboxDistributionAfterProcessing(enrollments, results);
          }
          
          // Log any failures
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[SCHEDULER] Failed to process enrollment ${enrollments[index].id}:`, result.reason);
            }
          });

          if (enrollments.length >= this.databaseClient.getBatchSize()) {
            await this.sleep(FULL_BATCH_BACKOFF_MS);
          }
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
        const retryableReadError = isRetryableSupabaseReadError(toRetryableReadInput(error));
        if (!(error as any)?.reportedToSlack) {
          reportErrorToSlack(
            retryableReadError
              ? 'Scheduler worker main loop deferred (retryable read-path error)'
              : 'Scheduler worker main loop error (fatal)',
            {
              severity: retryableReadError ? 'warning' : 'critical',
              error: errorMessage,
              alertPolicy: retryableReadError
                ? 'transient_retryable_warning'
                : 'critical_failure',
              aggregationKey: retryableReadError ? 'scheduler-main-loop' : undefined,
              summaryFields: {
                worker: 'scheduler',
                operation: 'main-loop',
              },
            },
          );
        }
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

  private startSingleFlightInterval(options: {
    taskName: string;
    intervalMs: number;
    runImmediately?: boolean;
    task: () => Promise<void>;
    onError: (error: unknown) => void;
  }): ReturnType<typeof setInterval> {
    let isRunning = false;

    const runTask = async () => {
      if (!this.running) {
        return;
      }

      if (isRunning) {
        console.log(`[${options.taskName}] Previous run still in progress; skipping overlapping tick`);
        return;
      }

      isRunning = true;
      try {
        await options.task();
      } catch (error) {
        options.onError(error);
      } finally {
        isRunning = false;
      }
    };

    if (options.runImmediately) {
      void runTask();
    }

    return setInterval(() => {
      void runTask();
    }, options.intervalMs);
  }

  private groupEnrollmentsByCampaign(
    enrollments: Enrollment[],
  ): Map<string, CampaignEnrollmentBatchItem[]> {
    const campaignGroups = new Map<string, CampaignEnrollmentBatchItem[]>();

    enrollments.forEach((enrollment, originalIndex) => {
      const existing = campaignGroups.get(enrollment.campaign_id) ?? [];
      existing.push({ enrollment, originalIndex });
      campaignGroups.set(enrollment.campaign_id, existing);
    });

    return campaignGroups;
  }

  private async loadCampaignContexts(
    campaignGroups: Map<string, CampaignEnrollmentBatchItem[]>,
  ): Promise<Map<string, CampaignProcessingContext>> {
    const campaignIds = Array.from(campaignGroups.keys());
    if (campaignIds.length === 0) {
      return new Map();
    }

    const { data: campaigns, error: campaignsError } = await this.supabase
      .from('campaigns')
      .select(
        'id, flow_data, current_flow_version_number, schedule, owner_id, account_id, jitter_percentage, sending_interval_seconds, created_at, status, deleted_at, accounts(jitter_percentage)',
      )
      .in('id', campaignIds);

    if (campaignsError) {
      throw campaignsError;
    }

    const { data: nodes, error: nodesError } = await this.supabase
      .from('nodes')
      .select('*')
      .in('campaign_id', campaignIds)
      .is('deleted_at', null);

    if (nodesError) {
      throw nodesError;
    }

    const nodesByCampaignId = new Map<string, DatabaseNode[]>();
    for (const node of (nodes ?? []) as DatabaseNode[]) {
      const existing = nodesByCampaignId.get(node.campaign_id) ?? [];
      existing.push(node);
      nodesByCampaignId.set(node.campaign_id, existing);
    }

    const currentEmailPairs: Array<{ enrollment_id: string; node_id: string }> = [];
    for (const [campaignId, batchItems] of campaignGroups.entries()) {
      const campaignNodesById = new Map(
        (nodesByCampaignId.get(campaignId) ?? []).map((node) => [node.id, node]),
      );

      for (const { enrollment } of batchItems) {
        if (!enrollment.current_node_id) {
          continue;
        }

        const currentNode = campaignNodesById.get(enrollment.current_node_id);
        if (currentNode?.node_type === 'email') {
          currentEmailPairs.push({
            enrollment_id: enrollment.id,
            node_id: currentNode.id,
          });
        }
      }
    }

    const latestMessageJobByPair = await this.loadLatestMessageJobs(currentEmailPairs);
    const campaignById = new Map(
      ((campaigns ?? []) as SchedulerCampaignRecord[]).map((campaign) => [campaign.id, campaign]),
    );

    const contexts = new Map<string, CampaignProcessingContext>();
    for (const campaignId of campaignIds) {
      const campaign = campaignById.get(campaignId) ?? null;
      const campaignNodes = nodesByCampaignId.get(campaignId) ?? [];
      const accountJitter = getAccountJitter(campaign?.accounts);

      contexts.set(campaignId, {
        campaign,
        jitterPercentage: campaign?.jitter_percentage ?? accountJitter ?? 10.0,
        accountMissingConfig: Boolean(
          campaign &&
            campaign.jitter_percentage == null &&
            campaign.account_id &&
            accountJitter === null,
        ),
        nodesById: new Map(campaignNodes.map((node) => [node.id, node])),
        nodesByFlowNodeId: new Map(
          campaignNodes.map((node) => [node.flow_node_id, node]),
        ),
        latestMessageJobByPair,
      });
    }

    return contexts;
  }

  private async loadLatestMessageJobs(
    pairs: Array<{ enrollment_id: string; node_id: string }>,
  ): Promise<Map<string, LatestMessageJobStatus>> {
    if (pairs.length === 0) {
      return new Map();
    }

    const pairKeys = new Set(
      pairs.map((pair) => `${pair.enrollment_id}:${pair.node_id}`),
    );
    const enrollmentIds = [...new Set(pairs.map((pair) => pair.enrollment_id))];
    const nodeIds = [...new Set(pairs.map((pair) => pair.node_id))];

    const { data, error } = await this.supabase
      .from('message_jobs')
      .select('id, enrollment_id, node_id, sent_at, status, created_at')
      .in('enrollment_id', enrollmentIds)
      .in('node_id', nodeIds)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const latestByPair = new Map<string, LatestMessageJobStatus>();
    for (const row of (data ?? []) as LatestMessageJobStatus[]) {
      const pairKey = `${row.enrollment_id}:${row.node_id}`;
      if (!pairKeys.has(pairKey) || latestByPair.has(pairKey)) {
        continue;
      }

      latestByPair.set(pairKey, row);
    }

    return latestByPair;
  }

  /**
   * Start interval maintenance background task
   */
  private startIntervalMaintenance(): void {
    this.intervalMaintenanceTimer = this.startSingleFlightInterval({
      taskName: 'INTERVAL MAINTENANCE',
      intervalMs: 60000,
      runImmediately: true,
      task: async () => {
        await maintainCampaignIntervals(this.supabase);
      },
      onError: (err) => {
        console.error('[INTERVAL MAINTENANCE] Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        reportErrorToSlack('Scheduler: interval maintenance failed', {
          severity: 'warning',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: 'scheduler-interval-maintenance',
          summaryFields: {
            worker: 'scheduler',
            operation: 'maintainCampaignIntervals',
          },
        });
      },
    });
  }

  /**
   * Start stale lock cleanup background task
   */
  private startStaleLockCleanup(): void {
    this.staleLockCleanupTimer = this.startSingleFlightInterval({
      taskName: 'STALE LOCK CLEANUP',
      intervalMs: 300000,
      task: async () => {
        const { data, error } = await this.supabase.rpc('cleanup_stale_interval_locks', {
          p_lock_timeout_minutes: 5
        });
        
        if (error) {
          console.error('[STALE LOCK CLEANUP] Error:', error);
          reportErrorToSlack('Scheduler: stale lock cleanup RPC failed', {
            severity: 'warning',
            error: error.message,
            alertPolicy: isRetryableSupabaseReadError(error.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: 'scheduler-stale-lock-cleanup',
            summaryFields: {
              worker: 'scheduler',
              operation: 'cleanup_stale_interval_locks',
            },
          });
        } else if (data > 0) {
          console.log(`[STALE LOCK CLEANUP] Released ${data} stale locks`);
        }
      },
      onError: (error) => {
        console.error('[STALE LOCK CLEANUP] Error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        reportErrorToSlack('Scheduler: stale lock cleanup failed', {
          severity: 'warning',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: 'scheduler-stale-lock-cleanup',
          summaryFields: {
            worker: 'scheduler',
            operation: 'cleanup_stale_interval_locks',
          },
        });
      },
    });
  }

  /**
   * Start processed interval check background task
   */
  private startProcessedIntervalCheck(): void {
    this.processedIntervalCheckTimer = this.startSingleFlightInterval({
      taskName: 'PROCESSED INTERVAL CHECK',
      intervalMs: 60000,
      task: async () => {
        const { data, error } = await this.supabase.rpc('check_and_update_processed_intervals', {
          p_campaign_id: null // Check all campaigns
        });
        
        if (error) {
          console.error('[PROCESSED INTERVAL CHECK] Error:', error);
          reportErrorToSlack('Scheduler: processed interval check RPC failed', {
            severity: 'warning',
            error: error.message,
            alertPolicy: isRetryableSupabaseReadError(error.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: 'scheduler-processed-interval-check',
            summaryFields: {
              worker: 'scheduler',
              operation: 'check_and_update_processed_intervals',
            },
          });
        } else if (data > 0) {
          console.log(`[PROCESSED INTERVAL CHECK] Updated ${data} processed interval(s)`);
        }
      },
      onError: (error) => {
        console.error('[PROCESSED INTERVAL CHECK] Error:', error);
        const msg = error instanceof Error ? error.message : String(error);
        reportErrorToSlack('Scheduler: processed interval check failed', {
          severity: 'warning',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: 'scheduler-processed-interval-check',
          summaryFields: {
            worker: 'scheduler',
            operation: 'check_and_update_processed_intervals',
          },
        });
      },
    });
  }

  /**
   * Start batch interval assignment background task
   */
  private startBatchIntervalAssignment(): void {
    this.batchIntervalAssignmentTimer = this.startSingleFlightInterval({
      taskName: 'BATCH INTERVAL',
      intervalMs: 30000,
      runImmediately: true,
      task: async () => {
        await batchAssignIntervalJobs(this.supabase, this.mailboxRotationIndex);
      },
      onError: (err) => {
        console.error('[BATCH INTERVAL] Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        reportErrorToSlack('Scheduler: batch interval assignment failed', {
          severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: 'scheduler-batch-interval-assignment',
          summaryFields: {
            worker: 'scheduler',
            operation: 'batchAssignIntervalJobs',
          },
        });
      },
    });
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
   */
  private async processEnrollment(
    enrollment: Enrollment,
    context?: CampaignProcessingContext,
  ): Promise<void> {
    const enrollmentId = enrollment.id.substring(0, 8);
    console.log(`[ENROLLMENT ${enrollment.id}] Starting processing... (state: ${enrollment.state}, current_node: ${enrollment.current_node_id?.substring(0, 8) || 'null'})`);
    
    try {
      const campaign = context?.campaign;
      if (!campaign) {
        throw new Error(`Campaign ${enrollment.campaign_id} not found`);
      }
      console.log(
        `[ENROLLMENT ${enrollmentId}] Using preloaded campaign ${enrollment.campaign_id.substring(0, 8)}. Account ID: ${campaign.account_id?.substring(0, 8) || 'MISSING'}`,
      );

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

      const activeFlowVersionNumber = campaign.current_flow_version_number ?? 0;

      // 3. Evaluate flow - find next node(s) (loads from database)
      console.log(`[ENROLLMENT ${enrollmentId}] Evaluating flow. Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null (entry point)'}`);
      const evaluationResult = await evaluateFlow(
        enrollment,
        enrollment.campaign_id,
        campaign.flow_data,
        this.supabase,
        context,
      );

      if (evaluationResult.evaluationFailed) {
        const deferMs = 60_000;
        const nextRun = new Date(Date.now() + deferMs).toISOString();
        const evaluationError = evaluationResult.evaluationError ?? 'Could not load flow nodes';
        const retryableReadError = isRetryableSupabaseReadError(evaluationError);
        console.warn(
          `[ENROLLMENT ${enrollmentId}] Flow evaluation failed (database read). Deferring retry in ${deferMs / 1000}s: ${evaluationResult.evaluationError ?? 'unknown'}`
        );
        reportErrorToSlack(
          retryableReadError
            ? 'Scheduler: enrollment processing deferred (retryable read-path error)'
            : 'Scheduler: flow evaluation deferred (database read failed)',
          {
            severity: 'warning',
            enrollment_id: enrollment.id,
            campaign_id: enrollment.campaign_id,
            error: evaluationError,
            alertPolicy: retryableReadError
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: retryableReadError
              ? `scheduler-retryable-read:${enrollment.campaign_id}`
              : `scheduler-flow-evaluation:${enrollment.campaign_id}:${evaluationError}`,
            summaryFields: {
              campaign_id: enrollment.campaign_id,
            },
          }
        );
        await this.supabase
          .from('enrollments')
          .update({
            next_run_at: nextRun,
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id)
          .eq('state', 'active');
        return;
      }

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
          .update({
            state: 'completed',
            current_flow_version_number: activeFlowVersionNumber || enrollment.current_flow_version_number || null,
          })
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
            .update({
              current_node_id: node.id,
              current_flow_version_number: activeFlowVersionNumber,
            })
            .eq('id', enrollment.id);
          
          console.log(`[ENROLLMENT ${enrollmentId}] Email node reached. Updated current_node_id to ${node.id.substring(0, 8)}. Job will be created by batch process.`);
          
        } else if (node.node_type === 'waitTime' || node.node_type === 'wait') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling waitTime node...`);
          // Handle waitTime node with schedule (NO JITTER - wait times should be exact)
          await handleWaitTimeNode(
            enrollment,
            node,
            campaign.schedule,
            activeFlowVersionNumber,
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
            let selectedNode = context?.nodesByFlowNodeId?.get(selectedFlowNodeId) ?? null;
            let selectedNodeError: { message: string } | null = null;

            if (!selectedNode && !context?.nodesByFlowNodeId) {
              const response = await this.supabase
                .from('nodes')
                .select('*')
                .eq('campaign_id', enrollment.campaign_id)
                .eq('flow_node_id', selectedFlowNodeId)
                .is('deleted_at', null)
                .single();
              selectedNode = response.data as DatabaseNode | null;
              selectedNodeError = response.error;
            }

            if (selectedNodeError) {
              const retryableSelectedNodeRead = isRetryableSupabaseReadError(
                toRetryableReadInput(selectedNodeError),
              );
              const errMsg = selectedNodeError.message ?? 'Node lookup failed';
              console.error(`Selected node ${selectedFlowNodeId} lookup failed: ${errMsg}`);
              reportErrorToSlack(
                retryableSelectedNodeRead
                  ? 'Scheduler: selected node lookup deferred (retryable read-path error)'
                  : 'Scheduler: selected node lookup failed',
                {
                  severity: 'warning',
                  enrollment_id: enrollment.id,
                  campaign_id: enrollment.campaign_id,
                  flow_node_id: selectedFlowNodeId,
                  error: errMsg,
                  alertPolicy: retryableSelectedNodeRead
                    ? 'transient_retryable_warning'
                    : 'persistent_config_warning',
                  aggregationKey: retryableSelectedNodeRead
                    ? `scheduler-selected-node-read:${enrollment.campaign_id}`
                    : `scheduler-selected-node-lookup:${enrollment.campaign_id}:${selectedFlowNodeId}`,
                  summaryFields: {
                    campaign_id: enrollment.campaign_id,
                    flow_node_id: selectedFlowNodeId,
                  },
                },
              );
              // Update enrollment to AICategorizer node and set next_run_at for retry
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: node.id,
                  current_flow_version_number: activeFlowVersionNumber,
                  next_run_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
                })
                .eq('id', enrollment.id);
            } else if (!selectedNode) {
              console.error(`Selected node ${selectedFlowNodeId} not found: Node not found`);
              reportErrorToSlack('Scheduler: selected node not found (flow inconsistency)', {
                severity: 'warning',
                enrollment_id: enrollment.id,
                campaign_id: enrollment.campaign_id,
                flow_node_id: selectedFlowNodeId,
                error: 'Node not found',
                alertPolicy: 'persistent_config_warning',
                aggregationKey: `scheduler-selected-node-missing:${enrollment.campaign_id}:${selectedFlowNodeId}`,
                summaryFields: {
                  campaign_id: enrollment.campaign_id,
                  flow_node_id: selectedFlowNodeId,
                },
              });
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: node.id,
                  current_flow_version_number: activeFlowVersionNumber,
                  next_run_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
                })
                .eq('id', enrollment.id);
            } else {
              // Update enrollment to AICategorizer node, then process the selected node
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: node.id,
                  current_flow_version_number: activeFlowVersionNumber,
                })
                .eq('id', enrollment.id);

              // Set next_run_at to process the selected node immediately
              await this.supabase
                .from('enrollments')
                .update({
                  current_node_id: selectedNode.id,
                  current_flow_version_number: activeFlowVersionNumber,
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
                current_flow_version_number: activeFlowVersionNumber,
                next_run_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
              })
              .eq('id', enrollment.id);
          }
        } else if (node.node_type === 'dataSender') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling DataSender node...`);
          // Handle DataSender node (placeholder)
          await handleDataSenderNode(enrollment, node, activeFlowVersionNumber, this.supabase);
          console.log(`[ENROLLMENT ${enrollmentId}] DataSender node processed.`);
        } else if (node.node_type === 'leadSource') {
          // LeadSource is an entry point, not a traversal node
          // If we encounter it during traversal, mark flow as complete (cycle detected)
          console.warn(`[ENROLLMENT ${enrollmentId}] LeadSource node encountered during traversal - marking as completed`);
          await this.supabase
            .from('enrollments')
            .update({
              state: 'completed',
              current_flow_version_number: activeFlowVersionNumber || enrollment.current_flow_version_number || null,
            })
            .eq('id', enrollment.id);
        } else {
          // Handle other node types (unknown types)
          console.warn(`[ENROLLMENT ${enrollmentId}] Unknown node type '${node.node_type}'. Updating current_node_id and continuing.`);
          // For now, just update current_node_id and set next_run_at to process immediately
          await this.supabase
            .from('enrollments')
            .update({
              current_node_id: node.id,
              current_flow_version_number: activeFlowVersionNumber,
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
      const errorMessage = formatUnknownError(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(`Error processing enrollment ${enrollment.id}:`, errorMessage);
      if (errorStack) {
        console.error('Stack trace:', errorStack);
      }

      if (isTransientUpstreamGatewayErrorMessage(errorMessage)) {
        const deferMs = 120_000;
        const nextRun = new Date(Date.now() + deferMs).toISOString();
        console.warn(
          `[ENROLLMENT ${enrollmentId}] Transient upstream error; deferring enrollment retry in ${deferMs / 1000}s`
        );
        reportErrorToSlack('Scheduler: enrollment processing deferred (transient upstream)', {
          severity: 'warning',
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          error: errorMessage,
          alertPolicy: 'transient_retryable_warning',
          aggregationKey: `scheduler-transient-upstream:${enrollment.campaign_id}`,
          summaryFields: {
            campaign_id: enrollment.campaign_id,
          },
        });
        try {
          await this.supabase
            .from('enrollments')
            .update({
              next_run_at: nextRun,
              updated_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id)
            .eq('state', 'active');
        } catch (deferUpdateError) {
          console.error(`Failed to defer enrollment ${enrollment.id} after transient error:`, deferUpdateError);
          const deferMsg = formatUnknownError(deferUpdateError);
          reportErrorToSlack('Scheduler: failed to defer enrollment after transient upstream error', {
            severity: 'warning',
            enrollment_id: enrollment.id,
            campaign_id: enrollment.campaign_id,
            error: deferMsg,
            alertPolicy: isRetryableSupabaseReadError(deferMsg)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `scheduler-failed-defer:${enrollment.campaign_id}`,
            summaryFields: {
              campaign_id: enrollment.campaign_id,
            },
          });
        }
        return;
      }

      const retryableReadError = isRetryableSupabaseReadError(
        toRetryableReadInput(error),
      );
      if (retryableReadError) {
        const deferMs = 60_000;
        const nextRun = new Date(Date.now() + deferMs).toISOString();
        console.warn(
          `[ENROLLMENT ${enrollmentId}] Retryable read-path failure; deferring enrollment retry in ${deferMs / 1000}s`,
        );
        reportErrorToSlack('Scheduler: enrollment processing deferred (retryable read-path error)', {
          severity: 'warning',
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          error: errorMessage,
          alertPolicy: 'transient_retryable_warning',
          aggregationKey: `scheduler-retryable-read:${enrollment.campaign_id}`,
          summaryFields: {
            campaign_id: enrollment.campaign_id,
          },
        });
        try {
          await this.supabase
            .from('enrollments')
            .update({
              next_run_at: nextRun,
              updated_at: new Date().toISOString(),
            })
            .eq('id', enrollment.id)
            .eq('state', 'active');
        } catch (deferUpdateError) {
          console.error(`Failed to defer enrollment ${enrollment.id} after retryable read failure:`, deferUpdateError);
          const deferMsg = formatUnknownError(deferUpdateError);
          reportErrorToSlack('Scheduler: failed to defer enrollment after retryable read failure', {
            severity: 'warning',
            enrollment_id: enrollment.id,
            campaign_id: enrollment.campaign_id,
            error: deferMsg,
            alertPolicy: isRetryableSupabaseReadError(deferMsg)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `scheduler-failed-defer:${enrollment.campaign_id}`,
            summaryFields: {
              campaign_id: enrollment.campaign_id,
            },
          });
        }
        return;
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
        const updateMsg = formatUnknownError(updateError);
        reportErrorToSlack('Scheduler: failed to update enrollment state after error', {
          severity: 'warning',
          enrollment_id: enrollment.id,
          campaign_id: enrollment.campaign_id,
          error: updateMsg,
          alertPolicy: isRetryableSupabaseReadError(updateMsg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `scheduler-update-enrollment-after-error:${enrollment.campaign_id}`,
          summaryFields: {
            campaign_id: enrollment.campaign_id,
          },
        });
      }

      // Continue with next enrollment (don't stop worker)
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

