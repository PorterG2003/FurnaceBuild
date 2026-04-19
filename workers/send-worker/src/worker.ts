import { SupabaseClient } from '@supabase/supabase-js';
import { buildCampaignEmailContent, type LeadLike } from '@furnace/email-lib';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { DatabaseClient } from './database.js';
import { sendEmail, sendReplyEmail } from './email.js';
import type { ReplyEmailOptions } from './email.js';
import { SmtpPool } from './smtp-pool.js';
import type { MessageJob, Mailbox, Lead } from './types.js';
import { isCampaignMessageJob } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
}

export class SendWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private smtpPool: SmtpPool;
  private running: boolean = false;
  private consecutiveEmptyPolls: number = 0;
  private readonly maxEmptyPolls: number = 10;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.smtpPool = new SmtpPool(100); // Cache up to 100 mailboxes
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('Send worker starting...');
    this.running = true;

    while (this.running) {
      try {
        // Manual sends (replies, forwards) take priority — poll manual first
        const manualJobs = await this.databaseClient.pollManual();
        if (manualJobs.length > 0) {
          this.consecutiveEmptyPolls = 0;
          const results = await Promise.allSettled(
            manualJobs.map(job => this.processMessageJob(job))
          );
          results.forEach((r, i) => {
            if (r.status === 'rejected') {
              console.error(`[SEND WORKER] Failed manual job ${manualJobs[i].id}:`, r.reason);
            }
          });
          continue;
        }

        // Then poll campaign jobs
        const messageJobs = await this.databaseClient.poll();

        if (messageJobs.length > 0) {
          this.consecutiveEmptyPolls = 0;
          console.log(`[SEND WORKER] Found ${messageJobs.length} message job(s) ready to send`);

          const results = await Promise.allSettled(
            messageJobs.map(job => this.processMessageJob(job))
          );

          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SEND WORKER] Processed ${messageJobs.length} job(s): ${successful} successful, ${failed} failed`);

          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[SEND WORKER] Failed to process message job ${messageJobs[index].id}:`, result.reason);
            }
          });
        } else {
          this.consecutiveEmptyPolls++;
          const pollInterval = this.calculatePollInterval();
          await this.sleep(pollInterval);
        }
      } catch (error) {
        console.error('[SEND WORKER] Error in main loop:', error);
        const msg = formatUnknownError(error);
        const retryable = isRetryableSupabaseReadError(msg);
        reportErrorToSlack('Send-worker main loop error', {
          severity: retryable ? 'warning' : 'critical',
          error: msg,
          alertPolicy: retryable ? 'transient_retryable_warning' : 'critical_failure',
          aggregationKey: retryable ? 'send-worker-main-loop:retryable' : undefined,
          summaryFields: {
            worker: 'send-worker',
          },
        });
        await this.sleep(5000);
      }
    }
  }

  /**
   * Calculate poll interval based on consecutive empty polls (adaptive polling)
   */
  private calculatePollInterval(): number {
    if (this.consecutiveEmptyPolls === 0) {
      return 2000; // 2 seconds when jobs found
    } else if (this.consecutiveEmptyPolls < 3) {
      return 5000; // 5 seconds after a few empty polls
    } else if (this.consecutiveEmptyPolls < 10) {
      return 10000; // 10 seconds when idle
    } else {
      return 30000; // 30 seconds when very idle (exponential backoff)
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    console.log('Stopping send worker...');
    this.running = false;
    // Close all SMTP connections
    await this.smtpPool.closeAll();
  }

  private async cancelMessageJob(messageJobId: string, reason: string): Promise<void> {
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'cancelled',
        error_message: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageJobId);
  }

  private async cancelCampaignMessageJob(messageJob: MessageJob, reason: string): Promise<void> {
    const now = new Date().toISOString();

    await this.supabase
      .from('message_jobs')
      .update({
        status: 'cancelled',
        error_message: reason,
        updated_at: now,
      })
      .eq('id', messageJob.id);

    await this.supabase
      .from('enrollments')
      .update({
        state: 'stopped',
        next_run_at: null,
        stopped_reason: 'error',
        stopped_at: now,
        stopped_error_message: reason,
        updated_at: now,
      })
      .eq('id', messageJob.enrollment_id)
      .in('state', ['active', 'paused']);
  }

  /**
   * check_mailbox_throttle_and_reserve returns success=false when rate limits re-queue the job to pending,
   * or when the RPC cancels the job (e.g. deleted parent for campaign sends). Log accordingly.
   */
  private logThrottleCheckOutcome(
    jobLabel: string,
    messageJobId: string,
    failureReason: string | null | undefined
  ): void {
    const fr = failureReason || 'Unknown throttle failure';
    const requeueReasons = [
      'Daily throttle limit exceeded',
      'Hourly throttle limit exceeded',
      'Minimum gap between sends not met',
    ];
    if (requeueReasons.includes(fr)) {
      console.log(
        `[SEND WORKER] Throttle check failed for ${jobLabel} ${messageJobId}: ${fr}. Job re-queued for retry.`
      );
    } else {
      console.log(
        `[SEND WORKER] Throttle check blocked ${jobLabel} ${messageJobId}: ${fr}. (Not a rate-limit retry; job may be cancelled — check message_jobs row.)`
      );
    }
  }

  /**
   * Process a single message job (already claimed from database)
   */
  private async processMessageJob(messageJob: MessageJob): Promise<void> {
    if (messageJob.message_type === 'inbox_reply') {
      return this.processInboxReplyJob(messageJob);
    }
    if (messageJob.message_type === 'inbox_forward') {
      return this.processInboxForwardJob(messageJob);
    }
    // Campaign (or null/legacy): continue with campaign send flow

    try {
      const message_job_id = messageJob.id;

      console.log(`[SEND WORKER] Processing message job: ${message_job_id}`);

      // 1. Load related data (lead, mailbox, node config)
      const { lead, mailbox, nodeConfig } = await this.loadJobData(messageJob);

      if (lead.deleted_at) {
        await this.cancelCampaignMessageJob(messageJob, 'Lead deleted');
        return;
      }
      if (mailbox.deleted_at) {
        await this.cancelCampaignMessageJob(messageJob, 'Mailbox deleted');
        return;
      }

      // 1b. Block list check — skip campaign sends to blocked addresses
      const { data: campaign } = await this.supabase
        .from('campaigns')
        .select('account_id, status, deleted_at')
        .eq('id', messageJob.campaign_id)
        .single();

      const canFinishClaimedJob =
        campaign &&
        !campaign.deleted_at &&
        (campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'stopped');

      if (!canFinishClaimedJob) {
        const reason = campaign?.deleted_at
          ? 'Campaign deleted'
          : `Campaign status is ${campaign?.status || 'unknown'}`;
        console.log(`[SEND WORKER] Campaign ${messageJob.campaign_id} is unavailable. Cancelling message job ${message_job_id}.`);
        await this.cancelCampaignMessageJob(messageJob, reason);
        return;
      }
      if (campaign.status !== 'running') {
        console.log(
          `[SEND WORKER] Campaign ${messageJob.campaign_id} is ${campaign.status}. Finishing already-claimed job ${message_job_id}.`
        );
      }

      const [enrollmentResult, nodeResult] = await Promise.all([
        this.supabase
          .from('enrollments')
          .select('deleted_at')
          .eq('id', messageJob.enrollment_id)
          .maybeSingle(),
        messageJob.node_id
          ? this.supabase
              .from('nodes')
              .select('deleted_at')
              .eq('id', messageJob.node_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      if (enrollmentResult.data?.deleted_at) {
        await this.cancelCampaignMessageJob(messageJob, 'Enrollment deleted');
        return;
      }
      if (nodeResult.data?.deleted_at) {
        await this.cancelCampaignMessageJob(messageJob, 'Node deleted');
        return;
      }

      const accountId = campaign.account_id;
      if (accountId) {
        const blocked = await this.isEmailBlocked(accountId, lead.email);
        if (blocked) {
          console.log(`[SEND WORKER] Lead ${lead.email} is blocked, marking job ${message_job_id} as blocked`);
          await this.supabase
            .from('message_jobs')
            .update({
              status: 'blocked',
              error_message: 'Lead blocked',
            })
            .eq('id', message_job_id);
          return;
        }
      }

      // 2. Atomic throttle check and reservation
      // This atomically checks throttle limits and updates counters
      // If throttle fails, job is cancelled by the function
      const { data: throttleResult, error: throttleError } = await this.supabase
        .rpc('check_mailbox_throttle_and_reserve', {
          p_message_job_id: message_job_id
        })
        .single();

      if (throttleError) {
        // RPC call failed - this could be a function not found error or other issue
        // Check if job is still in reserved status - if so, mark as failed
        // If not, it might have been cancelled by another process
        const { data: currentJob } = await this.supabase
          .from('message_jobs')
          .select('status')
          .eq('id', message_job_id)
          .single();
        
        if (currentJob?.status === 'reserved') {
          // Job is still reserved, so the RPC call genuinely failed
          throw new Error(`Failed to check mailbox throttle for message job ${message_job_id}: ${throttleError.message}`);
        } else {
          // Job status changed (might be cancelled or processed by another worker)
          console.log(`[SEND WORKER] Job ${message_job_id} status changed to ${currentJob?.status}, skipping throttle check`);
          return; // Skip this job, continue to next
        }
      }

      // Type assertion for RPC result
      const result = throttleResult as { success: boolean; failure_reason: string | null } | null;

      if (!result?.success) {
        this.logThrottleCheckOutcome('message job', message_job_id, result?.failure_reason);
        return;
      }

      // Throttle check passed - proceed with sending

      // 2b. Get first sent message for this campaign+lead (for thread continuation)
      const threadFirst = await this.getFirstSentMessageForCampaignLead(messageJob.campaign_id, messageJob.lead_id);

      // 3. Generate email content from template (shared pipeline with preview)
      let content;
      try {
        content = buildCampaignEmailContent(
          {
            subject: nodeConfig.subject,
            body_html: nodeConfig.body_html,
            body_text: nodeConfig.body_text,
            template: nodeConfig.template,
            body: nodeConfig.body,
            signature: mailbox.signature ?? undefined,
          },
          lead as unknown as LeadLike,
          { deterministic: false }
        );
      } catch (err) {
        const msg = formatUnknownError(err);
        reportErrorToSlack('Send-worker: campaign email content build/parse failed (initial email may not render correctly)', {
          severity: 'critical',
          message_job_id: message_job_id,
          campaign_id: messageJob.campaign_id,
          error: msg,
          alertPolicy: 'persistent_config_warning',
          aggregationKey: `send-worker-campaign-content-parse:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
        throw err;
      }
      const currentSubject = content.subject;
      const emailBody = content.bodyMerged;
      const isHtmlBody = content.isHtmlBody;
      const emailBodyText = content.bodyText;

      // Subject: use current node's subject; if follow-up and empty, use first email's subject
      let subject: string;
      let inReplyTo: string | null = null;
      let references: string | null = null;
      if (threadFirst) {
        if (threadFirst.provider_message_id) {
          inReplyTo = threadFirst.provider_message_id;
          references = threadFirst.provider_message_id;
        }
        if (currentSubject.trim() === '') {
          const nc = threadFirst.message_data?.node_config;
          const firstConfig = {
            subject: (nc?.subject ?? nc?.template ?? '') as string,
          };
          let firstContent;
          try {
            firstContent = buildCampaignEmailContent(
              firstConfig,
              lead as unknown as LeadLike,
              { deterministic: false }
            );
          } catch (err) {
            const msg = formatUnknownError(err);
            reportErrorToSlack('Send-worker: first-email subject/content parse failed (thread follow-up)', {
              severity: 'warning',
              message_job_id: message_job_id,
              campaign_id: messageJob.campaign_id,
              error: msg,
          alertPolicy: 'persistent_config_warning',
          aggregationKey: `send-worker-thread-followup-parse:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
            });
            throw err;
          }
          subject = firstContent.subject;
        } else {
          subject = currentSubject;
        }
      } else {
        subject = currentSubject;
      }

      // Check if this is a test mode job (skip SMTP sending)
      // Test mailboxes are identified by @furnace.test email domain
      const isTestMailbox = mailbox.email_address.endsWith('@furnace.test');
      const skipSmtp = isTestMailbox || (messageJob.message_data as any)?.skip_smtp === true;
      let providerMessageId: string;

      if (skipSmtp) {
        // Test mode: Skip SMTP sending, generate fake message ID
        const testReason = isTestMailbox 
          ? `test mailbox detected (${mailbox.email_address})`
          : 'skip_smtp flag set';
        console.log(`[TEST MODE] Processing message job ${message_job_id} (SMTP sending skipped - ${testReason})`);
        providerMessageId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 15)}@furnace.test`;
      } else {
        // Production mode: Send via SMTP
        console.log(`[SEND WORKER] Sending email via SMTP for message job ${message_job_id}`);
        // 4. Get SMTP transporter from pool (reuses connection if available)
        const transporter = await this.smtpPool.getTransporter(mailbox);

        try {
          // 5. Send email (with optional threading headers for follow-ups)
          providerMessageId = await sendEmail(
            transporter,
            mailbox,
            messageJob,
            lead,
            subject,
            emailBody,
            inReplyTo,
            references,
            isHtmlBody ? { bodyHtml: emailBody, bodyText: emailBodyText ?? undefined } : undefined
          );
          
          // Mark message sent (for maxMessages tracking)
          this.smtpPool.markMessageSent(mailbox.id);
          
          console.log(`[SEND WORKER] Email sent successfully for message job ${message_job_id} (provider_message_id: ${providerMessageId})`);
        } catch (error: any) {
          // On connection/auth errors, remove transporter from cache so it gets recreated
          if (error.code === 'EAUTH' || error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.error(`[SEND WORKER] SMTP connection error for mailbox ${mailbox.id}, removing from pool:`, error);
            this.smtpPool.removeTransporter(mailbox.id);
          }
          throw error; // Re-throw to be handled by outer error handling
        }
      }

      // 6. Update message_job status
      await this.supabase
        .from('message_jobs')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
        })
        .eq('id', message_job_id);

      // 6a. Throttle counters already updated by check_mailbox_throttle_and_reserve() function
      // No need to update mailbox_throttles here

      // 6b. Update enrollment to trigger scheduler re-evaluation
      // This allows the scheduler to pick up the enrollment immediately and proceed to next node
      try {
        const { error: enrollmentError } = await this.supabase
          .from('enrollments')
          .update({ next_run_at: new Date().toISOString() })
          .eq('id', messageJob.enrollment_id)
          .eq('state', 'active'); // Only update active enrollments
        
        if (enrollmentError) {
          // Log error but don't fail the send (email is already sent)
          console.error(`[SEND WORKER] Failed to update enrollment ${messageJob.enrollment_id} next_run_at:`, enrollmentError);
          reportErrorToSlack('Send-worker: failed to update enrollment next_run_at', {
            severity: 'warning',
            enrollment_id: messageJob.enrollment_id,
            message_job_id: message_job_id,
            error: enrollmentError.message,
            alertPolicy: isRetryableSupabaseReadError(enrollmentError.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `send-worker-enrollment-next-run:${messageJob.campaign_id}`,
            summaryFields: {
              campaign_id: messageJob.campaign_id,
            },
          });
        } else {
          console.log(`[SEND WORKER] Updated enrollment ${messageJob.enrollment_id} next_run_at to trigger scheduler re-evaluation`);
        }
      } catch (error) {
        // Log error but don't fail the send
        console.error(`[SEND WORKER] Error updating enrollment ${messageJob.enrollment_id}:`, error);
        const msg = formatUnknownError(error);
        reportErrorToSlack('Send-worker: failed to update enrollment next_run_at', {
          severity: 'warning',
          enrollment_id: messageJob.enrollment_id,
          message_job_id: message_job_id,
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `send-worker-enrollment-next-run:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
      }

      // 6c. Check if interval should be marked as processed (immediate, not waiting for scheduler timer)
      // This makes interval completion happen immediately instead of waiting up to 1 minute
      try {
        const { data: processedCount, error: processedError } = await this.supabase
          .rpc('check_and_update_processed_intervals', {
            p_campaign_id: messageJob.campaign_id
          });
        
        if (processedError) {
          // Log error but don't fail the send (email is already sent)
          console.error(`[SEND WORKER] Failed to check processed intervals for campaign ${messageJob.campaign_id}:`, processedError);
          reportErrorToSlack('Send-worker: check_and_update_processed_intervals failed', {
            severity: 'warning',
            campaign_id: messageJob.campaign_id,
            message_job_id: message_job_id,
            error: processedError.message,
            alertPolicy: isRetryableSupabaseReadError(processedError.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `send-worker-processed-intervals:${messageJob.campaign_id}`,
            summaryFields: {
              campaign_id: messageJob.campaign_id,
            },
          });
        } else if (processedCount && processedCount > 0) {
          console.log(`[SEND WORKER] Marked ${processedCount} interval(s) as processed for campaign ${messageJob.campaign_id}`);
        }
      } catch (error) {
        // Log error but don't fail the send
        console.error(`[SEND WORKER] Error checking processed intervals for campaign ${messageJob.campaign_id}:`, error);
        const msg = formatUnknownError(error);
        reportErrorToSlack('Send-worker: check_and_update_processed_intervals failed', {
          severity: 'warning',
          campaign_id: messageJob.campaign_id,
          message_job_id: message_job_id,
          error: msg,
          alertPolicy: isRetryableSupabaseReadError(msg)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `send-worker-processed-intervals:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
      }

      // 7. Create event record and update campaign_stats (atomic for campaign sends)
      const eventData = {
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        test_mode: skipSmtp,
        sent_subject: subject,
        sent_body_html: emailBody,
        sent_body_text: emailBodyText,
      };
      if (isCampaignMessageJob(messageJob)) {
        const { error } = await this.supabase.rpc('record_sent_event_and_increment', {
          p_campaign_id: messageJob.campaign_id,
          p_lead_id: messageJob.lead_id,
          p_enrollment_id: messageJob.enrollment_id,
          p_message_job_id: messageJob.id,
          p_event_data: eventData,
        });
        if (error) {
          console.error(`[SEND WORKER] Failed to record sent event and increment campaign_stats for campaign ${messageJob.campaign_id}:`, error);
          reportErrorToSlack('Send-worker: record_sent_event_and_increment failed (campaign stats may be out of sync)', {
            severity: 'warning',
            campaign_id: messageJob.campaign_id,
            message_job_id: messageJob.id,
            error: error.message,
            alertPolicy: isRetryableSupabaseReadError(error.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `send-worker-record-sent:${messageJob.campaign_id}`,
            summaryFields: {
              campaign_id: messageJob.campaign_id,
            },
          });
        }
      } else {
        await this.supabase.from('events').insert({
          campaign_id: messageJob.campaign_id,
          account_id: accountId,
          lead_id: messageJob.lead_id,
          enrollment_id: messageJob.enrollment_id,
          message_job_id: messageJob.id,
          event_type: 'sent',
          event_data: eventData,
        });
      }

      if (skipSmtp) {
        console.log(`[TEST MODE] Successfully processed message job ${message_job_id} (no email sent)`);
      } else {
        console.log(`[SEND WORKER] Successfully processed message job ${message_job_id}`);
      }

    } catch (error) {
      console.error(`[SEND WORKER] Error processing message job ${messageJob.id}:`, error);
      
      // Mark job as failed with error message
      const errorMessage = formatUnknownError(error);

      const retryableJobError = isRetryableSupabaseReadError(errorMessage);
      reportErrorToSlack('Send-worker failed to process message job', {
        severity: retryableJobError ? 'warning' : 'critical',
        error: errorMessage,
        message_job_id: messageJob.id,
        enrollment_id: messageJob.enrollment_id,
        campaign_id: messageJob.campaign_id,
        alertPolicy: retryableJobError ? 'transient_retryable_warning' : 'critical_failure',
        aggregationKey: retryableJobError
          ? `send-worker-process-message-job:${messageJob.campaign_id}`
          : undefined,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
        },
      });
      
      try {
        await this.supabase
          .from('message_jobs')
          .update({
            status: 'failed',
            error_message: errorMessage,
          })
          .eq('id', messageJob.id);
        
        console.log(`[SEND WORKER] Marked message job ${messageJob.id} as failed`);

        // Only update processed intervals for campaign jobs (not inbox reply/forward)
        if (isCampaignMessageJob(messageJob)) {
          try {
            const { data: processedCount, error: processedError } = await this.supabase
              .rpc('check_and_update_processed_intervals', {
                p_campaign_id: messageJob.campaign_id
              });
            if (processedError) {
              console.error(`[SEND WORKER] Failed to check processed intervals for campaign ${messageJob.campaign_id}:`, processedError);
            } else if (processedCount && processedCount > 0) {
              console.log(`[SEND WORKER] Marked ${processedCount} interval(s) as processed for campaign ${messageJob.campaign_id}`);
            }
          } catch (processedCheckError) {
            console.error(`[SEND WORKER] Error checking processed intervals for campaign ${messageJob.campaign_id}:`, processedCheckError);
          }
        }
      } catch (updateError) {
        // Log but don't throw - we've already logged the original error
        console.error(`[SEND WORKER] Failed to update message job ${messageJob.id} status to failed:`, updateError);
        const updateMsg = formatUnknownError(updateError);
        reportErrorToSlack('Send-worker: failed to mark message_job as failed', {
          severity: isRetryableSupabaseReadError(updateMsg) ? 'warning' : 'critical',
          message_job_id: messageJob.id,
          enrollment_id: messageJob.enrollment_id,
          error: updateMsg,
          campaign_id: messageJob.campaign_id,
          alertPolicy: isRetryableSupabaseReadError(updateMsg)
            ? 'transient_retryable_warning'
            : 'critical_failure',
          aggregationKey: isRetryableSupabaseReadError(updateMsg)
            ? `send-worker-mark-failed:${messageJob.campaign_id}`
            : undefined,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
      }
      
      // Re-throw to be caught by Promise.allSettled in the main loop
      throw error;
    }
  }

  /**
   * Process an inbox reply job: send reply email, insert email_messages, update email_threads.
   * Does not update enrollment or intervals (flow is irrelevant).
   */
  private async processInboxReplyJob(messageJob: MessageJob): Promise<void> {
    const message_job_id = messageJob.id;
    const md = messageJob.message_data || {};
    const threadId = md.thread_id as string | undefined;
    const inReplyToMessageId = md.in_reply_to_message_id as string | undefined;

    if (!threadId || !inReplyToMessageId) {
      throw new Error(`Inbox reply job ${message_job_id} missing thread_id or in_reply_to_message_id`);
    }

    console.log(`[SEND WORKER] Processing inbox reply job: ${message_job_id}`);

    // 1. Load mailbox
    const { data: mailbox, error: mailboxError } = await this.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', messageJob.mailbox_id)
      .single();
    if (mailboxError || !mailbox) {
      throw new Error(`Failed to load mailbox ${messageJob.mailbox_id}: ${mailboxError?.message}`);
    }
    if ((mailbox as Mailbox).deleted_at) {
      await this.cancelMessageJob(message_job_id, 'Mailbox deleted');
      return;
    }

    // 2. Throttle check (same as campaign)
    const { data: throttleResult, error: throttleError } = await this.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: message_job_id })
      .single();
    if (throttleError) {
      const { data: currentJob } = await this.supabase
        .from('message_jobs')
        .select('status')
        .eq('id', message_job_id)
        .single();
      if (currentJob?.status === 'reserved') {
        throw new Error(`Throttle check failed for reply job ${message_job_id}: ${throttleError.message}`);
      }
      return;
    }
    const result = throttleResult as { success: boolean; failure_reason: string | null } | null;
    if (!result?.success) {
      this.logThrottleCheckOutcome('reply job', message_job_id, result?.failure_reason);
      return;
    }

    // 3. Send reply via SMTP
    const transporter = await this.smtpPool.getTransporter(mailbox as Mailbox);
    const rawAttachments = Array.isArray(md.attachments) ? md.attachments : [];
    // Normalize: support both camelCase (from client) and snake_case (if DB/PostgREST ever returns it)
    const fileAttachments = rawAttachments
      .map((att: Record<string, unknown>) => {
        const a = att as { filename?: string; contentType?: string; content_type?: string; content?: string };
        return {
          filename: a.filename ?? 'attachment',
          contentType: a.contentType ?? a.content_type ?? 'application/octet-stream',
          content: a.content ?? '',
        };
      })
      .filter((att) => typeof att.content === 'string' && att.content.length > 0);
    console.log(`[SEND WORKER] Reply job ${message_job_id} attachments: ${fileAttachments.length} (raw: ${rawAttachments.length})`);
    const replyOptions: ReplyEmailOptions = {
      toEmail: md.to_email || '',
      toName: md.to_name ?? null,
      cc: Array.isArray(md.cc) ? md.cc : undefined,
      subject: md.subject || '(No subject)',
      bodyText: md.body_text || md.body_html || '',
      bodyHtml: md.body_html ?? null,
      inReplyTo: md.in_reply_to ?? null,
      references: md.message_references ?? null,
      attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
    };
    const replyBodyEmpty = !(replyOptions.bodyText || '').trim() && !(replyOptions.bodyHtml || '').trim();
    if (replyBodyEmpty) {
      reportErrorToSlack('Send-worker: inbox reply had empty body (initial email may not have been parsed)', {
        severity: 'warning',
        message_job_id: message_job_id,
        thread_id: threadId,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-empty-reply-body:${threadId}`,
        summaryFields: {
          thread_id: threadId,
        },
      });
    }
    let providerMessageId: string;
    try {
      providerMessageId = await sendReplyEmail(transporter, mailbox as Mailbox, messageJob, replyOptions);
      this.smtpPool.markMessageSent(mailbox.id);
    } catch (err: any) {
      if (err.code === 'EAUTH' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT') {
        this.smtpPool.removeTransporter(mailbox.id);
      }
      throw err;
    }

    // 4. Load thread for participants, message count, and account_id
    const { data: thread, error: threadError } = await this.supabase
      .from('email_threads')
      .select('participants, message_count, account_id')
      .eq('id', threadId)
      .single();
    if (threadError || !thread) {
      throw new Error(`Failed to load thread ${threadId}: ${threadError?.message}`);
    }

    const participants = (thread.participants || []) as string[];
    const toAdd = [replyOptions.toEmail, ...(replyOptions.cc || [])].filter(Boolean);
    const newParticipants = [...new Set([...participants, ...toAdd])];

    // Build attachment metadata for email_messages (filename, contentType, size; no base64)
    const replyAttachmentMeta =
      fileAttachments.length > 0
        ? fileAttachments.map((att: { filename: string; contentType?: string; content: string }) => ({
            filename: att.filename,
            contentType: att.contentType ?? 'application/octet-stream',
            size: Buffer.from(att.content, 'base64').length,
          }))
        : [];

    // 5. Insert email_messages (sent reply)
    const now = new Date().toISOString();
    const { error: insertError } = await this.supabase
      .from('email_messages')
      .insert({
        thread_id: threadId,
        account_id: thread.account_id,
        message_job_id: message_job_id,
        direction: 'sent',
        from_email: mailbox.email_address,
        from_name: mailbox.display_name,
        to_email: replyOptions.toEmail,
        to_name: replyOptions.toName || null,
        cc: replyOptions.cc && replyOptions.cc.length > 0 ? replyOptions.cc : null,
        subject: replyOptions.subject,
        body_text: replyOptions.bodyText,
        body_html: replyOptions.bodyHtml,
        message_id: providerMessageId,
        in_reply_to: replyOptions.inReplyTo,
        message_references: replyOptions.references,
        received_at: now,
        attachments: replyAttachmentMeta,
      });
    if (insertError) {
      throw new Error(`Failed to insert email_messages for reply: ${insertError.message}`);
    }

    // 6. Update email_threads (last_message_at, message_count, participants)
    const { error: updateThreadError } = await this.supabase
      .from('email_threads')
      .update({
        last_message_at: now,
        message_count: (thread.message_count || 0) + 1,
        participants: newParticipants,
        updated_at: now,
      })
      .eq('id', threadId);
    if (updateThreadError) {
      throw new Error(`Failed to update email_threads: ${updateThreadError.message}`);
    }

    // 7. Mark message_job sent
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'sent',
        sent_at: now,
        provider_message_id: providerMessageId,
        updated_at: now,
      })
      .eq('id', message_job_id);

    console.log(`[SEND WORKER] Inbox reply job ${message_job_id} sent successfully`);
  }

  /**
   * Process an inbox forward job: send forward email to new recipients.
   * Forward is send-only (no email_messages insert, no email_threads update).
   */
  private async processInboxForwardJob(messageJob: MessageJob): Promise<void> {
    const message_job_id = messageJob.id;
    const md = messageJob.message_data || {};
    const threadId = md.thread_id as string | undefined;

    if (!threadId) {
      throw new Error(`Inbox forward job ${message_job_id} missing thread_id`);
    }

    console.log(`[SEND WORKER] Processing inbox forward job: ${message_job_id}`);

    // 1. Load mailbox
    const { data: mailbox, error: mailboxError } = await this.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', messageJob.mailbox_id)
      .single();
    if (mailboxError || !mailbox) {
      throw new Error(`Failed to load mailbox ${messageJob.mailbox_id}: ${mailboxError?.message}`);
    }
    if ((mailbox as Mailbox).deleted_at) {
      await this.cancelMessageJob(message_job_id, 'Mailbox deleted');
      return;
    }

    // 2. Throttle check (same as reply)
    const { data: throttleResult, error: throttleError } = await this.supabase
      .rpc('check_mailbox_throttle_and_reserve', { p_message_job_id: message_job_id })
      .single();
    if (throttleError) {
      const { data: currentJob } = await this.supabase
        .from('message_jobs')
        .select('status')
        .eq('id', message_job_id)
        .single();
      if (currentJob?.status === 'reserved') {
        throw new Error(`Throttle check failed for forward job ${message_job_id}: ${throttleError.message}`);
      }
      return;
    }
    const result = throttleResult as { success: boolean; failure_reason: string | null } | null;
    if (!result?.success) {
      this.logThrottleCheckOutcome('forward job', message_job_id, result?.failure_reason);
      return;
    }

    // 3. Send forward via SMTP (no In-Reply-To/References)
    const transporter = await this.smtpPool.getTransporter(mailbox as Mailbox);
    const rawForwardAttachments = Array.isArray(md.attachments) ? md.attachments : [];
    const forwardFileAttachments = rawForwardAttachments
      .map((att: Record<string, unknown>) => {
        const a = att as { filename?: string; contentType?: string; content_type?: string; content?: string };
        return {
          filename: a.filename ?? 'attachment',
          contentType: a.contentType ?? a.content_type ?? 'application/octet-stream',
          content: a.content ?? '',
        };
      })
      .filter((att) => typeof att.content === 'string' && att.content.length > 0);
    console.log(`[SEND WORKER] Forward job ${message_job_id} attachments: ${forwardFileAttachments.length} (raw: ${rawForwardAttachments.length})`);
    const forwardOptions: ReplyEmailOptions = {
      toEmail: md.to_email || '',
      toName: md.to_name ?? null,
      cc: Array.isArray(md.cc) ? md.cc : undefined,
      subject: md.subject || '(No subject)',
      bodyText: md.body_text || md.body_html || '',
      bodyHtml: md.body_html ?? null,
      inReplyTo: null,
      references: null,
      attachments: forwardFileAttachments.length > 0 ? forwardFileAttachments : undefined,
    };
    const forwardBodyEmpty = !(forwardOptions.bodyText || '').trim() && !(forwardOptions.bodyHtml || '').trim();
    if (forwardBodyEmpty) {
      reportErrorToSlack('Send-worker: inbox forward had empty body (initial email may not have been parsed)', {
        severity: 'warning',
        message_job_id: message_job_id,
        thread_id: threadId,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-empty-forward-body:${threadId}`,
        summaryFields: {
          thread_id: threadId,
        },
      });
    }
    try {
      await sendReplyEmail(transporter, mailbox as Mailbox, messageJob, forwardOptions);
      this.smtpPool.markMessageSent(mailbox.id);
    } catch (err: any) {
      if (err.code === 'EAUTH' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT') {
        this.smtpPool.removeTransporter(mailbox.id);
      }
      throw err;
    }

    // 4. Mark message_job sent (no email_messages or email_threads update)
    const now = new Date().toISOString();
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'sent',
        sent_at: now,
        updated_at: now,
      })
      .eq('id', message_job_id);

    console.log(`[SEND WORKER] Inbox forward job ${message_job_id} sent successfully`);
  }

  /**
   * Get the first sent campaign email for this campaign+lead (for thread continuation).
   * Returns null if this is the first email or no previous sent job exists.
   */
  private async getFirstSentMessageForCampaignLead(
    campaignId: string,
    leadId: string
  ): Promise<{ id: string; provider_message_id: string | null; message_data: any } | null> {
    const { data, error } = await this.supabase
      .from('message_jobs')
      .select('id, provider_message_id, message_data')
      .eq('campaign_id', campaignId)
      .eq('lead_id', leadId)
      .eq('status', 'sent')
      .or('message_type.is.null,message_type.eq.campaign')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as { id: string; provider_message_id: string | null; message_data: any };
  }

  /**
   * Load related data for message job (lead, mailbox, node config)
   */
  private async loadJobData(messageJob: MessageJob): Promise<{
    lead: Lead;
    mailbox: Mailbox;
    nodeConfig: any;
  }> {
    // Load lead
    const { data: lead, error: leadError } = await this.supabase
      .from('leads')
      .select('*')
      .eq('id', messageJob.lead_id)
      .single();

    if (leadError || !lead) {
      throw new Error(`Failed to load lead ${messageJob.lead_id}: ${leadError?.message}`);
    }

    // Load mailbox
    const { data: mailbox, error: mailboxError } = await this.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', messageJob.mailbox_id)
      .single();

    if (mailboxError || !mailbox) {
      throw new Error(`Failed to load mailbox ${messageJob.mailbox_id}: ${mailboxError?.message}`);
    }

    // Get node config from message_data
    const nodeConfig = messageJob.message_data?.node_config || {};

    return {
      lead: lead as Lead,
      mailbox: mailbox as Mailbox,
      nodeConfig,
    };
  }

  /**
   * @deprecated This method is no longer used. Throttle checking is now done via
   * the check_mailbox_throttle_and_reserve() RPC function which is called directly
   * in processMessageJob().
   */
  private async reserveMessageJob(messageJob: MessageJob): Promise<boolean> {
    // Deprecated - not used anymore
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if an email is blocked for an account (exact email or domain match).
   */
  private async isEmailBlocked(accountId: string, email: string): Promise<boolean> {
    const { data: entries, error } = await this.supabase
      .from('block_list')
      .select('value, type')
      .eq('account_id', accountId);

    if (error || !entries?.length) return false;

    const normalizedEmail = email.trim().toLowerCase();
    const atIndex = normalizedEmail.indexOf('@');
    const domain = atIndex >= 0 && atIndex < normalizedEmail.length - 1
      ? normalizedEmail.slice(atIndex + 1)
      : null;

    for (const entry of entries) {
      const v = (entry.value || '').trim().toLowerCase();
      if (entry.type === 'email' && v === normalizedEmail) return true;
      if (entry.type === 'domain' && domain && v === domain) return true;
    }
    return false;
  }
}

