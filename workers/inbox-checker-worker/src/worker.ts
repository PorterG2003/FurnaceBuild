import { SupabaseClient } from '@supabase/supabase-js';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import pLimit from 'p-limit';
import {
  applyMailboxImapFailureUpdate,
  classifyImapError,
} from '@furnace/mailbox-lib';
import { DatabaseClient } from './database.js';
import { ImapClient } from './imap-client.js';
import { MessageProcessor } from './message-processor.js';
import { ThreadManager } from './thread-manager.js';
import type { Mailbox } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  concurrencyLimit?: number; // Max parallel mailbox processing
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

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.imapClient = new ImapClient();
    this.messageProcessor = new MessageProcessor();
    this.threadManager = new ThreadManager(config.supabase);
    this.concurrencyLimit = config.concurrencyLimit ?? 10; // Process 10 mailboxes in parallel
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('[INBOX CHECKER] Worker starting...');
    this.running = true;

    while (this.running) {
      try {
        // Claim mailboxes that need checking
        const mailboxes = await this.databaseClient.claimMailboxesToCheck();

        if (mailboxes.length > 0) {
          this.consecutiveEmptyPolls = 0;
          console.log(`[INBOX CHECKER] Found ${mailboxes.length} mailbox(es) to check`);

          // Process with concurrency limit
          const limit = pLimit(this.concurrencyLimit);
          const results = await Promise.allSettled(
            mailboxes.map(mailbox => 
              limit(() => this.processMailbox(mailbox))
            )
          );

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
        } else {
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
        await this.sleep(5000); // Wait before retrying
      }
    }
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
      console.log(`[INBOX CHECKER] Processing mailbox ${mailbox.id} (${mailbox.email_address}) since=${lastSyncedAt?.toISOString() ?? 'null (first sync)'}`);

      // Fetch new messages
      const messages = await this.imapClient.fetchNewMessages(mailbox, lastSyncedAt);
      console.log(`[INBOX CHECKER] Found ${messages.length} new message(s) in mailbox ${mailbox.id}`);

      if (messages.length === 0) {
        await this.supabase
          .from('mailboxes')
          .update({
            last_synced_at: new Date().toISOString(),
            imap_claimed_at: null,
          })
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

          // Check for reply
          if (this.messageProcessor.isReply(message)) {
            const handled = await this.threadManager.handleReply(mailbox, message, { isUnsubscribe });
            if (handled) {
              replies++;
              if (isUnsubscribe) {
                await this.threadManager.autoBlockUnsubscribe(mailbox, message);
                unsubscribes++;
              }
            } else {
              // Not a reply to our message - might be spam or unrelated
              console.log(`[INBOX CHECKER] Message ${message.messageId} has In-Reply-To but doesn't match any sent message`);
              if (isUnsubscribe) {
                await this.threadManager.autoBlockUnsubscribe(mailbox, message);
                unsubscribes++;
              }
            }
            continue;
          }

          // Check for unsubscribe
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
        .update({
          last_synced_at: new Date().toISOString(),
          imap_claimed_at: null,
        })
        .eq('id', mailbox.id);

      console.log(`[INBOX CHECKER] Mailbox ${mailbox.id} processed: ${replies} replies, ${bounces} bounces, ${unsubscribes} unsubscribes`);
    } catch (error) {
      console.error(`[INBOX CHECKER] Error processing mailbox ${mailbox.id}:`, error);

      const classified = classifyImapError(error);
      reportErrorToSlack(`Inbox-checker failed to process mailbox: ${classified.message}`, {
        severity: 'warning',
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `inbox-checker-imap:${mailbox.imap_host}:${classified.kind}`,
        mailbox_id: mailbox.id,
        email_address: mailbox.email_address,
        summaryFields: {
          imap_host: mailbox.imap_host,
          failure_kind: classified.kind,
          example_email: mailbox.email_address,
        },
      });

      await this.supabase
        .from('mailboxes')
        .update(applyMailboxImapFailureUpdate(classified.kind, classified.message))
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
   * Stop the worker gracefully
   */
  stop(): void {
    console.log('[INBOX CHECKER] Stopping worker...');
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
