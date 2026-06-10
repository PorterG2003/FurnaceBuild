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
import { handleReplyEmailNode } from './node-handlers/reply-email-handler.js';
import { handleDataSenderNode } from './node-handlers/data-sender-handler.js';
import { maintainCampaignIntervals } from './interval-management.js';
import { batchAssignIntervalJobs } from './batch-interval-assignment.js';
import { resolveOooResumePollIntervalMs, runOutOfOfficeResumeTick } from './ooo-resume-tick.js';
import type { CategorizerLlmTransport } from './categorizer/classify.js';
import type { CampaignSchedule, Enrollment } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  /** Injectable categorizer LLM transport (tests use a scripted fake). */
  categorizerClassifyTransport?: CategorizerLlmTransport;
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
const RESERVED_RECLAIM_INTERVAL_MS = 5 * 60 * 1000;
const SELF_RECOVERY_AUDIT_INTERVAL_MS = 15 * 60 * 1000;
const CATEGORIZER_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const CATEGORIZER_SWEEP_BATCH_SIZE = 100;
const RESERVED_RECLAIM_BATCH_SIZE = 50;
const RESERVED_RECLAIM_REARM_DELAY_SECONDS = 60;
const STALE_SENDING_BATCH_SIZE = 20;
const STALE_SENDING_MINUTES = 30;
const RESERVED_STALE_MINUTES = 5;

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
  private batchIntervalAssignmentTimer?: ReturnType<typeof setInterval>;
  private oooResumeTimer?: ReturnType<typeof setInterval>;
  private staleReservedReclaimTimer?: ReturnType<typeof setInterval>;
  private selfRecoveryAuditTimer?: ReturnType<typeof setInterval>;
  private categorizerSweepTimer?: ReturnType<typeof setInterval>;
  private readonly categorizerClassifyTransport?: CategorizerLlmTransport;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.categorizerClassifyTransport = config.categorizerClassifyTransport;
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
    
    // Start batch interval assignment (runs every 30 seconds)
    this.startBatchIntervalAssignment();

    this.startOutOfOfficeResumeProcessing();
    this.startStaleReservedReclaim();
    this.startSelfRecoveryAudit();
    this.startCategorizerSweep();

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
        const retryableReadError = isRetryableSupabaseReadError(errorMessage);
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
    if (this.batchIntervalAssignmentTimer) {
      clearInterval(this.batchIntervalAssignmentTimer);
    }
    if (this.oooResumeTimer) {
      clearInterval(this.oooResumeTimer);
    }
    if (this.staleReservedReclaimTimer) {
      clearInterval(this.staleReservedReclaimTimer);
    }
    if (this.selfRecoveryAuditTimer) {
      clearInterval(this.selfRecoveryAuditTimer);
    }
    if (this.categorizerSweepTimer) {
      clearInterval(this.categorizerSweepTimer);
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
      .select('id, enrollment_id, node_id, sent_at, status, status_reason, error_message, created_at')
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
   * Start batch interval assignment background task
   */
  /**
   * Drain due out-of-office thread resumes (reactivate enrollments stopped for reply).
   * Interval from OOO_RESUME_POLL_INTERVAL_MS (default 30 minutes).
   */
  private startOutOfOfficeResumeProcessing(): void {
    const intervalMs = resolveOooResumePollIntervalMs(process.env.OOO_RESUME_POLL_INTERVAL_MS);

    this.oooResumeTimer = this.startSingleFlightInterval({
      taskName: 'OOO RESUME',
      intervalMs,
      runImmediately: false,
      task: async () => {
        const processed = await runOutOfOfficeResumeTick(this.supabase);
        if (processed > 0) {
          console.log(`[OOO RESUME] Processed ${processed} due thread(s)`);
        }
      },
      onError: (err) => {
        console.error('[OOO RESUME] Error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        reportErrorToSlack('Scheduler: process_due_out_of_office_resumes failed', {
          severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: 'scheduler-ooo-resume',
          summaryFields: {
            worker: 'scheduler',
            operation: 'process_due_out_of_office_resumes',
          },
        });
      },
    });
    console.log(`[OOO RESUME] Poll interval ${Math.round(intervalMs / 1000)}s`);
  }

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

  private startStaleReservedReclaim(): void {
    this.staleReservedReclaimTimer = this.startSingleFlightInterval({
      taskName: 'STALE RESERVED RECLAIM',
      intervalMs: RESERVED_RECLAIM_INTERVAL_MS,
      runImmediately: false,
      task: async () => {
        const { data, error } = await this.supabase.rpc(
          'reclaim_stale_campaign_message_jobs',
          {
            p_batch_size: RESERVED_RECLAIM_BATCH_SIZE,
            p_rearm_delay_seconds: RESERVED_RECLAIM_REARM_DELAY_SECONDS,
            p_reserved_stale_minutes: RESERVED_STALE_MINUTES,
          },
        );

        if (error) {
          throw error;
        }

        const rows = Array.isArray(data) ? data : [];
        if (rows.length > 0) {
          console.log(`[STALE RESERVED RECLAIM] Reclaimed ${rows.length} stale reserved campaign job(s)`);
        }
      },
      onError: (error) => {
        const msg = formatUnknownError(error);
        console.error('[STALE RESERVED RECLAIM] Error:', msg);
        reportErrorToSlack('Scheduler: stale reserved reclaim failed', {
          severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'critical_failure',
          aggregationKey: 'scheduler-stale-reserved-reclaim',
          summaryFields: {
            worker: 'scheduler',
            operation: 'reclaim_stale_campaign_message_jobs',
          },
        });
      },
    });
  }

  /**
   * Safety net for lost categorizer wake events: wakes parked enrollments
   * whose latest replied thread is actionable. Event-driven wakes
   * (inbox-checker park RPC, manual category) are the primary mechanism;
   * this is expected to wake ~0 rows.
   */
  private startCategorizerSweep(): void {
    this.categorizerSweepTimer = this.startSingleFlightInterval({
      taskName: 'CATEGORIZER SWEEP',
      intervalMs: CATEGORIZER_SWEEP_INTERVAL_MS,
      runImmediately: false,
      task: async () => {
        const { data, error } = await this.supabase.rpc('sweep_parked_categorizer_enrollments', {
          p_batch_size: CATEGORIZER_SWEEP_BATCH_SIZE,
        });

        if (error) {
          throw error;
        }

        const woken = typeof data === 'number' ? data : 0;
        if (woken > 0) {
          console.log(`[CATEGORIZER SWEEP] Woke ${woken} parked enrollment(s) with actionable replies`);
        }
      },
      onError: (error) => {
        const msg = formatUnknownError(error);
        console.error('[CATEGORIZER SWEEP] Error:', msg);
        reportErrorToSlack('Scheduler: categorizer sweep failed', {
          severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'critical_failure',
          aggregationKey: 'scheduler-categorizer-sweep',
          summaryFields: {
            worker: 'scheduler',
            operation: 'sweep_parked_categorizer_enrollments',
          },
        });
      },
    });
  }

  private startSelfRecoveryAudit(): void {
    this.selfRecoveryAuditTimer = this.startSingleFlightInterval({
      taskName: 'SELF RECOVERY AUDIT',
      intervalMs: SELF_RECOVERY_AUDIT_INTERVAL_MS,
      runImmediately: false,
      task: async () => {
        const { data: finalizedRows, error: finalizeError } = await this.supabase.rpc(
          'finalize_stale_sending_campaign_message_jobs',
          {
            p_batch_size: STALE_SENDING_BATCH_SIZE,
            p_stale_minutes: STALE_SENDING_MINUTES,
          },
        );

        if (finalizeError) {
          throw finalizeError;
        }

        const finalizedCount = Array.isArray(finalizedRows) ? finalizedRows.length : 0;
        if (finalizedCount > 0) {
          console.log(
            `[SELF RECOVERY AUDIT] Finalized ${finalizedCount} stale sending campaign job(s) as uncertain send state`,
          );
        }

        const { data: healthRows, error: healthError } = await this.supabase.rpc(
          'get_job_self_recovery_health',
          {
            p_reserved_stale_minutes: RESERVED_STALE_MINUTES,
            p_sending_stale_minutes: STALE_SENDING_MINUTES,
          },
        );

        if (healthError) {
          throw healthError;
        }

        const health = Array.isArray(healthRows) ? healthRows[0] : null;

        // Categorizer invariants: orphaned holds (held jobs whose enrollment
        // is no longer active) and stale parks (branchable category
        // unprocessed >24h - both the wake event and the sweep failed).
        const { data: categorizerHealthRows, error: categorizerHealthError } = await this.supabase.rpc(
          'get_categorizer_health',
        );

        if (categorizerHealthError) {
          throw categorizerHealthError;
        }

        const categorizerHealth = Array.isArray(categorizerHealthRows)
          ? categorizerHealthRows[0]
          : null;
        const orphanedHeldJobs = Number(categorizerHealth?.orphaned_held_jobs ?? 0);
        const staleParkedEnrollments = Number(categorizerHealth?.stale_parked_enrollments ?? 0);

        if (!health && orphanedHeldJobs === 0 && staleParkedEnrollments === 0) {
          return;
        }

        const retryableStoppedCount = Number(health?.retryable_stopped_count ?? 0);
        const staleReservedCount = Number(health?.stale_reserved_count ?? 0);
        const staleSendingCount = Number(health?.stale_sending_count ?? 0);

        if (
          retryableStoppedCount > 0 ||
          staleReservedCount > 0 ||
          staleSendingCount > 0 ||
          finalizedCount > 0 ||
          orphanedHeldJobs > 0 ||
          staleParkedEnrollments > 0
        ) {
          const summary =
            `retryable_stopped=${retryableStoppedCount}, ` +
            `stale_reserved=${staleReservedCount}, ` +
            `stale_sending=${staleSendingCount}, ` +
            `finalized_stale_sending=${finalizedCount}, ` +
            `orphaned_held_jobs=${orphanedHeldJobs}, ` +
            `stale_categorizer_parks=${staleParkedEnrollments}`;
          console.log(`[SELF RECOVERY AUDIT] ${summary}`);
          reportErrorToSlack('Scheduler: self-recovery audit found outstanding job-health issues', {
            severity: 'warning',
            error: summary,
            alertPolicy: 'transient_retryable_warning',
            aggregationKey: 'scheduler-self-recovery-audit',
            summaryFields: {
              worker: 'scheduler',
              operation: 'self-recovery-audit',
            },
          });
        }
      },
      onError: (error) => {
        const msg = formatUnknownError(error);
        console.error('[SELF RECOVERY AUDIT] Error:', msg);
        reportErrorToSlack('Scheduler: self-recovery audit failed', {
          severity: isRetryableSupabaseReadError(msg) ? 'warning' : 'critical',
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'critical_failure',
          aggregationKey: 'scheduler-self-recovery-audit-failed',
          summaryFields: {
            worker: 'scheduler',
            operation: 'self-recovery-audit',
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

      // Count enrollments per mailbox using locked lead mailboxes only.
      const mailboxCounts = new Map<string, number>();
      let unlockedCount = 0;

      for (const enrollment of campaignEnrollments) {
        const lead = leads?.find(l => l.id === enrollment.lead_id);
        if (lead?.deleted_at) {
          unlockedCount++;
        } else if (lead?.mailbox_id) {
          mailboxCounts.set(lead.mailbox_id, (mailboxCounts.get(lead.mailbox_id) || 0) + 1);
        } else {
          unlockedCount++;
        }
      }

      console.log(`[MAILBOX DIST] Campaign ${campaignId.substring(0, 8)}: ${campaignEnrollments.length} enrollment(s) ready`);
      console.log(`[MAILBOX DIST] Eligible mailboxes: ${eligibleMailboxes.length}`);
      console.log(`[MAILBOX DIST] Enrollments with locked mailbox: ${campaignEnrollments.length - unlockedCount}, unlocked (mailbox resolves at job creation): ${unlockedCount}`);
      
      // Show distribution
      const distribution: string[] = [];
      for (const cm of eligibleMailboxes) {
        const mailboxId = (cm as any).mailbox?.id || (cm as any).mailbox_id;
        if (mailboxId) {
          const count = mailboxCounts.get(mailboxId) || 0;
          distribution.push(`${mailboxId.substring(0, 8)}:${count}`);
        }
      }
      if (unlockedCount > 0) {
        distribution.push(`unlocked:${unlockedCount}`);
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
      
      if (evaluationResult.stopEnrollment) {
        const stoppedAt = new Date().toISOString();
        await this.supabase
          .from('enrollments')
          .update({
            state: 'stopped',
            next_run_at: null,
            stopped_reason: 'error',
            stopped_at: stoppedAt,
            stopped_error_message: evaluationResult.stopReason ?? 'Email attempt ended terminally',
            updated_at: stoppedAt,
          })
          .eq('id', enrollment.id)
          .eq('state', 'active');
        console.log(
          `[ENROLLMENT ${enrollmentId}] Stopped enrollment after terminal email attempt: ${evaluationResult.stopReason ?? 'unknown reason'}`,
        );
        return;
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
        
        if (node.node_type === 'email' && node.node_data?.send_mode === 'reply') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling reply-mode email node...`);
          // Reply-mode email: scheduler creates a campaign_reply job directly
          // (thread mailbox + threading headers); bypasses interval pacing.
          await handleReplyEmailNode(enrollment, node, this.supabase, {
            schedule: campaign.schedule,
            activeFlowVersionNumber,
          });
          console.log(`[ENROLLMENT ${enrollmentId}] Reply-mode email node processed.`);
        } else if (node.node_type === 'email') {
          console.log(`[ENROLLMENT ${enrollmentId}] Handling email node...`);
          // Email node: just set current_node_id and stop
          // Job creation will be handled by batch interval assignment once next_run_at is due.
          await this.supabase
            .from('enrollments')
            .update({
              current_node_id: node.id,
              current_flow_version_number: activeFlowVersionNumber,
              next_run_at: new Date().toISOString(),
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
          console.log(`[ENROLLMENT ${enrollmentId}] Handling Categorizer node...`);
          // The categorizer handler owns all enrollment updates: park,
          // classify, restore (Auto Reply), or branch by sourceHandle.
          await handleAICategorizerNode(
            enrollment,
            node,
            campaign.flow_data,
            this.supabase,
            {
              activeFlowVersionNumber,
              classifyTransport: this.categorizerClassifyTransport,
            },
          );
          console.log(`[ENROLLMENT ${enrollmentId}] Categorizer node processed.`);
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

      const retryableReadError = isRetryableSupabaseReadError(errorMessage);
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

