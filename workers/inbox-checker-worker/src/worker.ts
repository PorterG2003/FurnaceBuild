import { SupabaseClient } from '@supabase/supabase-js';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import pLimit from 'p-limit';
import {
  allFailuresAreInfraClass,
  applyMailboxImapFailureUpdate,
  applyMailboxImapSuccessUpdate,
  classifyImapError,
  inferImapInfraFailureCode,
} from '@furnace/mailbox-lib';
import { DatabaseClient } from './database.js';
import {
  IMAP_RECOVERY_BATCH_SIZE,
  IMAP_RECOVERY_COOLDOWN_HOURS,
  IMAP_RECOVERY_CONCURRENCY,
  IMAP_RECOVERY_DEFAULT_INTERVAL_MS,
  IMAP_RECOVERY_RUN_ON_START,
} from './imap-recovery-config.js';
import { runImapRecoveryTick } from './imap-recovery.js';
import { ImapClient } from './imap-client.js';
import { MessageProcessor } from './message-processor.js';
import { ThreadManager } from './thread-manager.js';
import type { Mailbox } from './types.js';

export interface ImapRecoveryConfig {
  intervalMs: number;
  batchSize: number;
  cooldownHours: number;
  concurrency: number;
  runOnStart: boolean;
}

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  concurrencyLimit?: number; // Max parallel mailbox processing
  recovery?: Partial<ImapRecoveryConfig>;
}

/**
 * Inbox checker worker - processes mailboxes for IMAP checking
 */
export class InboxCheckerWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private imapClient: ImapClient;
  private messageProcessor: MessageProcessor;
  private threadManager: ThreadManager;
  private running: boolean = false;
  private consecutiveEmptyPolls: number = 0;
  private concurrencyLimit: number;
  private recoveryConfig: ImapRecoveryConfig;
  private imapRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownWaiters: Array<() => void> = [];
  private activeBatch: Promise<unknown> | null = null;
  private activeBackgroundTasks = new Set<Promise<unknown>>();

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.imapClient = new ImapClient();
    this.messageProcessor = new MessageProcessor();
    this.threadManager = new ThreadManager(config.supabase);
    this.concurrencyLimit = config.concurrencyLimit ?? 10; // Process 10 mailboxes in parallel
    this.recoveryConfig = {
      intervalMs: config.recovery?.intervalMs ?? IMAP_RECOVERY_DEFAULT_INTERVAL_MS,
      batchSize: config.recovery?.batchSize ?? IMAP_RECOVERY_BATCH_SIZE,
      cooldownHours: config.recovery?.cooldownHours ?? IMAP_RECOVERY_COOLDOWN_HOURS,
      concurrency: config.recovery?.concurrency ?? IMAP_RECOVERY_CONCURRENCY,
      runOnStart: config.recovery?.runOnStart ?? IMAP_RECOVERY_RUN_ON_START,
    };
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('[INBOX CHECKER] Worker starting...');
    this.running = true;
    this.startImapRecoveryLoop();

    while (this.running) {
      try {
        // Claim mailboxes that need checking
        const mailboxes = await this.databaseClient.claimMailboxesToCheck();

        if (mailboxes.length > 0) {
          this.consecutiveEmptyPolls = 0;
          console.log(`[INBOX CHECKER] Found ${mailboxes.length} mailbox(es) to check`);

          // Process with concurrency limit
          const limit = pLimit(this.concurrencyLimit);
          const batchPromise = Promise.allSettled(
            mailboxes.map(mailbox =>
              limit(() => this.processMailbox(mailbox))
            )
          );
          this.activeBatch = batchPromise;
          let results: PromiseSettledResult<void>[];
          try {
            results = await batchPromise;
          } finally {
            this.activeBatch = null;
          }

          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[INBOX CHECKER] Processed ${mailboxes.length} mailbox(es): ${successful} successful, ${failed} failed`);

          // Log failures
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[INBOX CHECKER] Failed to process mailbox ${mailboxes[index].id}:`, result.reason);
            }
          });

          this.maybeAlertHotPathSystemicInfra(mailboxes, results);
        } else if (this.running) {
          // No mailboxes to check - adaptive polling
          this.consecutiveEmptyPolls++;
          const pollInterval = this.calculatePollInterval();
          await this.sleep(pollInterval);
        }
      } catch (error) {
        console.error('[INBOX CHECKER] Error in main loop:', error);
        const msg = formatUnknownError(error);
        const retryable = isRetryableSupabaseReadError(msg);
        reportErrorToSlack('Inbox-checker main loop error', {
          severity: retryable ? 'warning' : 'critical',
          error: msg,
          alertPolicy: retryable ? 'transient_retryable_warning' : 'critical_failure',
          aggregationKey: retryable ? 'inbox-checker-main-loop:retryable' : undefined,
          summaryFields: {
            worker: 'inbox-checker',
          },
        });
        if (this.running) {
          await this.sleep(5000); // Wait before retrying
        }
      }
    }

    if (this.activeBatch) {
      await this.activeBatch.catch(() => undefined);
    }
    await Promise.allSettled([...this.activeBackgroundTasks]);
    console.log('[INBOX CHECKER] Worker stopped.');
  }

  private maybeAlertHotPathSystemicInfra(
    mailboxes: Mailbox[],
    results: PromiseSettledResult<void>[],
  ): void {
    const successful = results.filter((result) => result.status === 'fulfilled').length;
    const failedResults = results
      .map((result, index) => ({ result, mailbox: mailboxes[index] }))
      .filter((entry): entry is { result: PromiseRejectedResult; mailbox: Mailbox } =>
        entry.result.status === 'rejected' && entry.mailbox != null,
      );

    if (successful > 0 || failedResults.length === 0) {
      return;
    }

    const failures = failedResults.map(({ result, mailbox }) => {
      const reason = result.reason;
      const classified = classifyImapError(reason);
      return {
        host: mailbox.imap_host,
        code: inferImapInfraFailureCode({
          code: (reason as { code?: string | null })?.code ?? null,
          message: classified.message,
        }),
        message: classified.message,
      };
    });

    if (!allFailuresAreInfraClass(failures)) {
      return;
    }

    const code = failures[0]?.code ?? 'unknown';
    reportErrorToSlack('Inbox-checker hot-path systemic IMAP failure', {
      severity: 'critical',
      alertPolicy: 'critical_failure',
      aggregationKey: 'inbox-checker-hot-path:systemic-infra',
      error: `${failedResults.length} mailbox check(s) failed with infra errors (sample ${code})`,
      summaryFields: {
        worker: 'inbox-checker',
        failure_code: code,
        failed_count: String(failedResults.length),
      },
    });
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
      let taskPromise!: Promise<void>;
      taskPromise = (async () => {
        try {
          await options.task();
        } catch (error) {
          options.onError(error);
        } finally {
          isRunning = false;
          this.activeBackgroundTasks.delete(taskPromise);
        }
      })();
      this.activeBackgroundTasks.add(taskPromise);
      await taskPromise;
    };

    if (options.runImmediately) {
      void runTask();
    }

    return setInterval(() => {
      void runTask();
    }, options.intervalMs);
  }

  private startImapRecoveryLoop(): void {
    if (this.imapRecoveryTimer) {
      return;
    }

    this.imapRecoveryTimer = this.startSingleFlightInterval({
      taskName: 'IMAP RECOVERY',
      intervalMs: this.recoveryConfig.intervalMs,
      runImmediately: this.recoveryConfig.runOnStart,
      task: async () => {
        await runImapRecoveryTick({
          supabase: this.supabase,
          databaseClient: this.databaseClient,
          batchSize: this.recoveryConfig.batchSize,
          cooldownHours: this.recoveryConfig.cooldownHours,
          concurrency: this.recoveryConfig.concurrency,
        });
      },
      onError: (error) => {
        const message = formatUnknownError(error);
        console.error('[IMAP RECOVERY] Error:', error);
        reportErrorToSlack('Inbox-checker IMAP recovery failed', {
          severity: 'critical',
          alertPolicy: 'critical_failure',
          error: message,
          summaryFields: {
            worker: 'inbox-checker',
          },
        });
      },
    });
  }

  /**
   * Process a single mailbox
   */
  private async processMailbox(mailbox: Mailbox): Promise<void> {
    try {
      if (mailbox.deleted_at) {
        await this.supabase
          .from('mailboxes')
          .update({ imap_claimed_at: null })
          .eq('id', mailbox.id);
        return;
      }

      const lastSyncedAt = mailbox.last_synced_at
        ? new Date(mailbox.last_synced_at)
        : null;

      // Fetch new messages
      const messages = await this.imapClient.fetchNewMessages(mailbox, lastSyncedAt);

      // Retry child-before-parent staged replies after IMAP is healthy
      try {
        const stagedAttached = await this.threadManager.retryPendingInboundReplies(mailbox);
        if (stagedAttached > 0) {
          console.log(
            `[INBOX CHECKER] Attached ${stagedAttached} previously staged inbound reply(ies) for mailbox ${mailbox.id}`,
          );
        }
      } catch (err) {
        console.error(`[INBOX CHECKER] Failed retrying pending inbound replies for ${mailbox.id}:`, err);
      }

      if (messages.length === 0) {
        await this.supabase
          .from('mailboxes')
          .update(applyMailboxImapSuccessUpdate())
          .eq('id', mailbox.id);
        return;
      }

      // Process each message
      let replies = 0;
      let bounces = 0;
      let unsubscribes = 0;

      for (const message of messages) {
        try {
          const isUnsubscribe = this.messageProcessor.isUnsubscribe(message);

          // Check for bounce
          if (this.messageProcessor.isBounce(message)) {
            await this.threadManager.handleBounce(mailbox, message);
            bounces++;
            continue;
          }

          // Try reply attach for threading-header replies and clearly-ours fallbacks
          const handled = await this.threadManager.handleReply(mailbox, message, { isUnsubscribe });
          if (handled) {
            replies++;
            if (isUnsubscribe) {
              await this.threadManager.autoBlockUnsubscribe(mailbox, message);
              unsubscribes++;
            }
            continue;
          }

          // Check for unsubscribe (unmatched message)
          if (isUnsubscribe) {
            await this.threadManager.autoBlockUnsubscribe(mailbox, message);
            unsubscribes++;
          }
        } catch (error) {
          console.error(`[INBOX CHECKER] Error processing message in mailbox ${mailbox.id}:`, error);
          // Continue with next message
        }
      }

      await this.supabase
        .from('mailboxes')
        .update(applyMailboxImapSuccessUpdate())
        .eq('id', mailbox.id);

      console.log(JSON.stringify({
        tag: 'inbox_mailbox_check',
        mailbox_id: mailbox.id,
        messages_fetched: messages.length,
        replies,
        bounces,
        unsubscribes,
      }));
    } catch (error) {
      console.error(`[INBOX CHECKER] Error processing mailbox ${mailbox.id}:`, error);

      const classified = classifyImapError(error);
      const errorCode = inferImapInfraFailureCode({
        code: (error as { code?: string | null })?.code ?? null,
        message: classified.message,
      });

      await this.supabase
        .from('mailboxes')
        .update(applyMailboxImapFailureUpdate(classified.kind, classified.message, {
          consecutiveFailures: mailbox.imap_consecutive_failures ?? 0,
          errorCode,
        }))
        .eq('id', mailbox.id);

      throw error;
    }
  }

  /**
   * Calculate poll interval based on consecutive empty polls (adaptive polling)
   */
  private calculatePollInterval(): number {
    if (this.consecutiveEmptyPolls === 0) {
      return 5000; // 5 seconds when mailboxes found
    } else if (this.consecutiveEmptyPolls < 3) {
      return 10000; // 10 seconds after a few empty polls
    } else if (this.consecutiveEmptyPolls < 10) {
      return 30000; // 30 seconds when idle
    } else {
      return 60000; // 60 seconds when very idle
    }
  }

  /**
   * Request graceful shutdown. Awaits active mailbox/recovery work.
   * Does not call process.exit — start() resolves after drain.
   */
  async stop(): Promise<void> {
    console.log('[INBOX CHECKER] Stopping worker...');
    this.running = false;
    if (this.imapRecoveryTimer) {
      clearInterval(this.imapRecoveryTimer);
      this.imapRecoveryTimer = null;
    }
    for (const wake of this.shutdownWaiters.splice(0)) {
      wake();
    }
    if (this.activeBatch) {
      await this.activeBatch.catch(() => undefined);
    }
    await Promise.allSettled([...this.activeBackgroundTasks]);
  }

  private sleep(ms: number): Promise<void> {
    if (!this.running || ms <= 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.shutdownWaiters = this.shutdownWaiters.filter((wake) => wake !== onShutdown);
        clearTimeout(timer);
        resolve();
      };
      const onShutdown = () => finish();
      const timer = setTimeout(finish, ms);
      this.shutdownWaiters.push(onShutdown);
    });
  }
}
