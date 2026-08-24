import { SupabaseClient } from '@supabase/supabase-js';
import {
  buildCampaignEmailContent,
  buildSpintaxSeed,
  buildStableSubmittedMessageId,
  formatMessageId,
  formatReferencesHeader,
  normalizeMessageId,
  normalizeThreadTopic,
  parseMessageIds,
  resolveOutboundThreading,
  type LeadLike,
  type OutboundThreadingContext,
  type ThreadTimelineEntry,
  type ThreadingDecision,
} from '../../../lib/email/dist/index.js';
import { loadThreadTimeline } from './loadThreadTimeline.js';
import { stampCopyRenderingId } from './stampCopyRendering.js';
import { describeLegacyThreadingDivergence } from './threadingParity.js';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import {
  applyMailboxSmtpFailureUpdate,
  classifySmtpError,
} from '@furnace/mailbox-lib';
import { DatabaseClient } from './database.js';
import { sendEmail, sendReplyEmail } from './email.js';
import type { ReplyEmailOptions, SendEmailResult } from './email.js';
import { SmtpPool } from './smtp-pool.js';
import { emitWebhookEvent } from './emit-webhook-event.js';
import { buildEmailSentWebhookPayload } from './email-sent-webhook-payload.js';
import type { MessageJob, Mailbox, Lead } from './types.js';
import { isCampaignMessageJob, isPriorityCampaignJob } from './types.js';
import { calculateNextRunAt } from '@furnace/campaign-lib/schedule.js';
import type { CampaignSchedule } from '@furnace/campaign-lib/schedule.js';
import {
  buildSentAttachmentMetadata,
  markAttachmentUploadsSent,
  resolveSendAttachments,
  drainInboxAttachmentGcQueue,
} from './sentAttachments.js';

class CampaignAttemptError extends Error {
  constructor(
    message: string,
    readonly statusReason: 'provider_error' | 'template_render_error' | 'uncertain_send_state' = 'provider_error',
  ) {
    super(message);
    this.name = 'CampaignAttemptError';
  }
}

/** Accept SendEmailResult or legacy bare Message-ID strings from test harnesses. */
function normalizeCampaignSendResult(
  result: SendEmailResult | string,
  fallbackSubmittedMessageId: string,
): SendEmailResult {
  if (typeof result === 'string') {
    return {
      submittedMessageId: fallbackSubmittedMessageId,
      providerMessageId: formatMessageId(result) || fallbackSubmittedMessageId,
    };
  }
  const submittedMessageId =
    formatMessageId(result.submittedMessageId) || fallbackSubmittedMessageId;
  return {
    submittedMessageId,
    providerMessageId:
      formatMessageId(result.providerMessageId) ||
      submittedMessageId ||
      fallbackSubmittedMessageId,
  };
}

type SentThreadMessageRecord = {
  threadId: string;
  messageJobId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  toName: string | null;
  cc?: string[] | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  referenceMessageIds?: string[] | null;
  threadTopic?: string | null;
  receivedAt?: string;
  attachments?: unknown[] | null;
};

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
  campaignEmailSender?: typeof sendEmail;
}

export class SendWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private smtpPool: SmtpPool;
  private campaignEmailSender: typeof sendEmail;
  private running: boolean = false;
  private consecutiveEmptyPolls: number = 0;
  private lastAttachmentGcAt = 0;
  private readonly maxEmptyPolls: number = 10;
  private shutdownWaiters: Array<() => void> = [];
  private activeBatch: Promise<unknown> | null = null;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
    this.smtpPool = new SmtpPool(100); // Cache up to 100 mailboxes
    this.campaignEmailSender = config.campaignEmailSender ?? sendEmail;
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
          const batchPromise = Promise.allSettled(
            manualJobs.map(job => this.processMessageJob(job))
          );
          this.activeBatch = batchPromise;
          let results: PromiseSettledResult<unknown>[];
          try {
            results = await batchPromise;
          } finally {
            this.activeBatch = null;
          }
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

          const batchPromise = Promise.allSettled(
            messageJobs.map(job => this.processMessageJob(job))
          );
          this.activeBatch = batchPromise;
          let results: PromiseSettledResult<unknown>[];
          try {
            results = await batchPromise;
          } finally {
            this.activeBatch = null;
          }

          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SEND WORKER] Processed ${messageJobs.length} job(s): ${successful} successful, ${failed} failed`);

          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[SEND WORKER] Failed to process message job ${messageJobs[index].id}:`, result.reason);
            }
          });
        } else if (this.running) {
          this.consecutiveEmptyPolls++;
          // Periodic attachment GC while idle (every ~5 minutes)
          if (Date.now() - this.lastAttachmentGcAt > 5 * 60 * 1000) {
            this.lastAttachmentGcAt = Date.now();
            try {
              const removed = await drainInboxAttachmentGcQueue(this.supabase);
              if (removed > 0) {
                console.log(`[SEND WORKER] Drained ${removed} inbox attachment GC path(s)`);
              }
            } catch (gcErr) {
              console.warn('[SEND WORKER] Attachment GC drain failed:', gcErr);
            }
          }
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
        if (this.running) {
          await this.sleep(5000);
        }
      }
    }

    if (this.activeBatch) {
      await this.activeBatch.catch(() => undefined);
    }
    console.log('Send worker stopped.');
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
   * Request graceful shutdown. Awaits the current batch, then closes SMTP.
   * Does not call process.exit — start() resolves after drain.
   */
  async stop(): Promise<void> {
    console.log('Stopping send worker...');
    this.running = false;
    for (const wake of this.shutdownWaiters.splice(0)) {
      wake();
    }
    if (this.activeBatch) {
      await this.activeBatch.catch(() => undefined);
    }
    // Close SMTP only after active sends settle — never mark unsent work successful.
    await this.smtpPool.closeAll();
  }

  private toCancelledStatusReason(reason: string): string {
    switch (reason) {
      case 'Campaign deleted':
        return 'campaign_deleted';
      case 'Mailbox deleted':
        return 'mailbox_deleted';
      case 'Lead deleted':
        return 'lead_deleted';
      case 'Enrollment deleted':
        return 'enrollment_deleted';
      case 'Node deleted':
        return 'node_deleted';
      default:
        return reason.startsWith('Enrollment not active')
          ? 'enrollment_not_active'
          : 'manually_cancelled';
    }
  }

  private async stopCampaignEnrollment(enrollmentId: string, reason: string): Promise<void> {
    const now = new Date().toISOString();

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
      .eq('id', enrollmentId)
      .in('state', ['active', 'paused']);
  }

  private async markMailboxSmtpFailureIfPermanent(mailboxId: string, error: unknown): Promise<void> {
    const classified = classifySmtpError(error);
    const updates = applyMailboxSmtpFailureUpdate(classified.kind, classified.message);

    if (updates == null) {
      return;
    }

    const { error: updateError } = await this.supabase
      .from('mailboxes')
      .update(updates)
      .eq('id', mailboxId);

    if (updateError) {
      console.error(`[SEND WORKER] Failed to mark mailbox ${mailboxId} smtp_status=error:`, updateError);
    }
  }

  private async cancelMessageJob(messageJobId: string, reason: string): Promise<void> {
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'cancelled',
        status_reason: this.toCancelledStatusReason(reason),
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
        status_reason: this.toCancelledStatusReason(reason),
        error_message: reason,
        updated_at: now,
      })
      .eq('id', messageJob.id);

    await this.stopCampaignEnrollment(messageJob.enrollment_id, reason);
  }

  private async markMessageJobSendingIfReserved(messageJobId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('message_jobs')
      .update({
        status: 'sending',
        status_reason: null,
        sending_started_at: now,
        updated_at: now,
      })
      .eq('id', messageJobId)
      .eq('status', 'reserved')
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to mark message job ${messageJobId} as sending: ${error.message}`);
    }

    return !!data?.id;
  }

  private async failCampaignMessageJob(
    messageJob: MessageJob,
    reason: string,
    statusReason: 'provider_error' | 'template_render_error' | 'uncertain_send_state' = 'provider_error',
  ): Promise<void> {
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'failed',
        status_reason: statusReason,
        error_message: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageJob.id);

    await this.stopCampaignEnrollment(messageJob.enrollment_id, reason);
  }

  private async deferCampaignMessageJobForRetryableError(
    messageJob: MessageJob,
    reason: string,
    retryDelayMs: number = 60_000,
  ): Promise<boolean> {
    const now = new Date();
    const retryAt = new Date(now.getTime() + retryDelayMs).toISOString();
    const { data, error } = await this.supabase
      .from('message_jobs')
      .update({
        status: 'deferred',
        status_reason: 'transient_read_error',
        reserved_at: null,
        lease_expires_at: null,
        claim_token: null,
        send_wait_reason: null as any,
        error_message: reason,
        updated_at: now.toISOString(),
      } as any)
      .eq('id', messageJob.id)
      .eq('status', 'reserved')
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to defer retryable message job ${messageJob.id}: ${error.message}`);
    }

    if (!data?.id) {
      return false;
    }

    const { error: enrollmentError } = await this.supabase
      .from('enrollments')
      .update({
        next_run_at: retryAt,
        updated_at: now.toISOString(),
      })
      .eq('id', messageJob.enrollment_id)
      .eq('state', 'active');

    if (enrollmentError) {
      throw new Error(
        `Failed to re-arm enrollment ${messageJob.enrollment_id} after retryable message job defer: ${enrollmentError.message}`
      );
    }

    return true;
  }

  private async requeueCampaignReplyJob(
    messageJob: MessageJob,
    schedule: CampaignSchedule | null,
    params: {
      retryFloor: Date;
      sendWaitReason?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const scheduledAt = calculateNextRunAt(params.retryFloor, schedule);
    const { data, error } = await this.supabase
      .from('message_jobs')
      .update({
        status: 'queued',
        status_reason: null,
        scheduled_at: scheduledAt,
        reserved_at: null,
        lease_expires_at: null,
        claim_token: null,
        send_wait_reason: params.sendWaitReason ?? null,
        error_message: params.errorMessage ?? null,
        updated_at: now,
      } as any)
      .eq('id', messageJob.id)
      .in('status', ['reserved', 'deferred'])
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to re-queue campaign_reply ${messageJob.id}: ${error.message}`);
    }

    if (!data?.id) {
      return false;
    }

    const { error: enrollmentError } = await this.supabase
      .from('enrollments')
      .update({
        next_run_at: scheduledAt,
        updated_at: now,
      })
      .eq('id', messageJob.enrollment_id)
      .eq('state', 'active');

    if (enrollmentError) {
      throw new Error(
        `Failed to re-arm enrollment ${messageJob.enrollment_id} for campaign_reply retry: ${enrollmentError.message}`
      );
    }

    return true;
  }

  private async promoteCampaignReplyThrottleRetry(
    messageJob: MessageJob,
    schedule: CampaignSchedule | null,
    failureReason: string | null | undefined,
  ): Promise<boolean> {
    const [{ data: currentJob, error: jobError }, { data: enrollment, error: enrollmentError }] =
      await Promise.all([
        this.supabase
          .from('message_jobs')
          .select('status, send_wait_reason')
          .eq('id', messageJob.id)
          .maybeSingle(),
        this.supabase
          .from('enrollments')
          .select('next_run_at')
          .eq('id', messageJob.enrollment_id)
          .maybeSingle(),
      ]);

    if (jobError) {
      throw new Error(`Failed to inspect campaign_reply ${messageJob.id} after throttle defer: ${jobError.message}`);
    }
    if (enrollmentError) {
      throw new Error(
        `Failed to inspect enrollment ${messageJob.enrollment_id} after campaign_reply throttle defer: ${enrollmentError.message}`
      );
    }

    const currentStatus = currentJob?.status ?? null;
    if (currentStatus === 'queued') {
      return true;
    }
    if (currentStatus !== 'reserved' && currentStatus !== 'deferred') {
      return false;
    }

    const retryFloor = enrollment?.next_run_at ? new Date(enrollment.next_run_at) : new Date();
    return this.requeueCampaignReplyJob(messageJob, schedule, {
      retryFloor,
      sendWaitReason: currentJob?.send_wait_reason ?? failureReason ?? null,
      errorMessage: null,
    });
  }

  private async finalizeCampaignMessageJobSent(
    messageJobId: string,
    providerMessageId: string,
    submittedMessageId?: string | null,
  ): Promise<void> {
    // Prefer extended signature when migration is applied; fall back for older DBs.
    let data: unknown;
    let error: { message: string } | null = null;
    if (submittedMessageId) {
      const extended = await this.supabase.rpc('finalize_message_job_sent', {
        p_message_job_id: messageJobId,
        p_provider_message_id: providerMessageId,
        p_submitted_message_id: submittedMessageId,
      });
      data = extended.data;
      error = extended.error;
      if (error?.message?.includes('Could not find the function') || error?.message?.includes('schema cache')) {
        const legacy = await this.supabase.rpc('finalize_message_job_sent', {
          p_message_job_id: messageJobId,
          p_provider_message_id: providerMessageId,
        });
        data = legacy.data;
        error = legacy.error;
        if (!legacy.error && submittedMessageId) {
          await this.supabase
            .from('message_jobs')
            .update({ submitted_message_id: submittedMessageId })
            .eq('id', messageJobId);
        }
      }
    } else {
      const legacy = await this.supabase.rpc('finalize_message_job_sent', {
        p_message_job_id: messageJobId,
        p_provider_message_id: providerMessageId,
      });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      throw new Error(`Failed to finalize sent message job ${messageJobId}: ${error.message}`);
    }

    if (data !== true) {
      throw new Error(`Failed to finalize sent message job ${messageJobId}: job was not in sending state`);
    }
  }

  private async recordSentMessageInThread(params: SentThreadMessageRecord): Promise<void> {
    const { data: thread, error: threadError } = await this.supabase
      .from('email_threads')
      .select('account_id, participants, message_count, last_message_at')
      .eq('id', params.threadId)
      .single();

    if (threadError || !thread) {
      throw new Error(`Failed to load thread ${params.threadId}: ${threadError?.message}`);
    }

    const now = params.receivedAt ?? new Date().toISOString();
    const { data: byJob, error: byJobError } = await this.supabase
      .from('email_messages')
      .select('id, received_at, message_job_id')
      .eq('thread_id', params.threadId)
      .eq('message_job_id', params.messageJobId)
      .maybeSingle();

    if (byJobError) {
      throw new Error(`Failed to inspect email_messages for ${params.messageJobId}: ${byJobError.message}`);
    }

    let effectiveReceivedAt = byJob?.received_at ?? now;

    if (!byJob) {
      const { data: byMessageId, error: byMessageIdError } = await this.supabase
        .from('email_messages')
        .select('id, received_at, message_job_id')
        .eq('thread_id', params.threadId)
        .eq('message_id', params.messageId)
        .maybeSingle();

      if (byMessageIdError) {
        throw new Error(
          `Failed to inspect existing email_messages by message_id for ${params.messageId}: ${byMessageIdError.message}`
        );
      }

      if (byMessageId) {
        effectiveReceivedAt = byMessageId.received_at ?? now;

        if (byMessageId.message_job_id !== params.messageJobId) {
          const { error: relinkError } = await this.supabase
            .from('email_messages')
            .update({
              message_job_id: params.messageJobId,
            })
            .eq('id', byMessageId.id);

          if (relinkError) {
            throw new Error(
              `Failed to relink email_messages ${byMessageId.id} to message job ${params.messageJobId}: ${relinkError.message}`
            );
          }
        }
      } else {
        const { error: insertError } = await this.supabase
          .from('email_messages')
          .insert({
            thread_id: params.threadId,
            account_id: thread.account_id,
            message_job_id: params.messageJobId,
            direction: 'sent',
            from_email: params.fromEmail,
            from_name: params.fromName,
            to_email: params.toEmail,
            to_name: params.toName,
            to_emails: params.toEmail?.trim() ? [params.toEmail.trim()] : null,
            cc: params.cc && params.cc.length > 0 ? params.cc : null,
            subject: params.subject,
            body_text: params.bodyText,
            body_html: params.bodyHtml,
            message_id: normalizeMessageId(params.messageId),
            in_reply_to: normalizeMessageId(params.inReplyTo),
            message_references: params.references,
            reference_message_ids: params.referenceMessageIds ?? parseMessageIds(params.references),
            thread_topic: params.threadTopic ?? null,
            received_at: now,
            attachments: params.attachments ?? null,
          });

        if (insertError) {
          throw new Error(`Failed to insert email_messages for sent thread message: ${insertError.message}`);
        }
      }
    }

    const { data: threadMessages, error: threadMessagesError } = await this.supabase
      .from('email_messages')
      .select('received_at')
      .eq('thread_id', params.threadId);

    if (threadMessagesError) {
      throw new Error(`Failed to reload thread messages for ${params.threadId}: ${threadMessagesError.message}`);
    }

    const participants = new Set<string>((thread.participants || []) as string[]);
    participants.add(params.fromEmail);
    participants.add(params.toEmail);
    for (const address of params.cc ?? []) {
      if (address) {
        participants.add(address);
      }
    }

    const observedLastMessageAt = (threadMessages ?? []).reduce<string | null>((latest, row) => {
      if (!row?.received_at) {
        return latest;
      }
      if (!latest) {
        return row.received_at;
      }
      return Date.parse(row.received_at) > Date.parse(latest) ? row.received_at : latest;
    }, null);
    const lastMessageAt =
      [thread.last_message_at, observedLastMessageAt, effectiveReceivedAt]
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? now;

    const { error: updateThreadError } = await this.supabase
      .from('email_threads')
      .update({
        last_message_at: lastMessageAt,
        message_count: threadMessages?.length ?? thread.message_count ?? 0,
        participants: [...participants],
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.threadId);

    if (updateThreadError) {
      throw new Error(`Failed to update email_threads for ${params.threadId}: ${updateThreadError.message}`);
    }
  }

  private async blockCampaignMessageJob(
    messageJob: MessageJob,
    reason: string,
    statusReason: 'lead_blocked' | 'mailbox_blocked' = 'lead_blocked',
  ): Promise<void> {
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'blocked',
        status_reason: statusReason,
        error_message: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageJob.id);

    await this.stopCampaignEnrollment(messageJob.enrollment_id, reason);
  }

  private async reconcileLeadMailboxAfterSuccessfulSend(
    messageJob: MessageJob,
    leadMailboxId: string | null | undefined,
  ): Promise<void> {
    if (leadMailboxId === messageJob.mailbox_id) {
      return;
    }

    if (leadMailboxId) {
      reportErrorToSlack('Send-worker: locked lead mailbox mismatched sent job mailbox', {
        severity: 'warning',
        campaign_id: messageJob.campaign_id,
        enrollment_id: messageJob.enrollment_id,
        lead_id: messageJob.lead_id,
        message_job_id: messageJob.id,
        error: `Lead mailbox ${leadMailboxId} did not match sent job mailbox ${messageJob.mailbox_id}.`,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-mailbox-lock-mismatch:${messageJob.campaign_id}:${messageJob.lead_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
        },
      });
      return;
    }

    const { data: updatedLead, error: updateLeadError } = await this.supabase
      .from('leads')
      .update({ mailbox_id: messageJob.mailbox_id })
      .eq('id', messageJob.lead_id)
      .is('mailbox_id', null)
      .select('id, mailbox_id')
      .maybeSingle();

    if (updateLeadError) {
      reportErrorToSlack('Send-worker: failed to lock lead mailbox after first send', {
        severity: 'warning',
        campaign_id: messageJob.campaign_id,
        enrollment_id: messageJob.enrollment_id,
        lead_id: messageJob.lead_id,
        message_job_id: messageJob.id,
        error: updateLeadError.message,
        alertPolicy: isRetryableSupabaseReadError(updateLeadError.message)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `send-worker-lock-lead-mailbox:${messageJob.campaign_id}:${messageJob.lead_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
        },
      });
      return;
    }

    if (updatedLead?.mailbox_id === messageJob.mailbox_id) {
      return;
    }

    const { data: currentLead, error: currentLeadError } = await this.supabase
      .from('leads')
      .select('id, mailbox_id')
      .eq('id', messageJob.lead_id)
      .maybeSingle();

    if (currentLeadError) {
      reportErrorToSlack('Send-worker: failed to verify lead mailbox after first send', {
        severity: 'warning',
        campaign_id: messageJob.campaign_id,
        enrollment_id: messageJob.enrollment_id,
        lead_id: messageJob.lead_id,
        message_job_id: messageJob.id,
        error: currentLeadError.message,
        alertPolicy: isRetryableSupabaseReadError(currentLeadError.message)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `send-worker-verify-lead-mailbox:${messageJob.campaign_id}:${messageJob.lead_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
        },
      });
      return;
    }

    if (currentLead?.mailbox_id !== messageJob.mailbox_id) {
      reportErrorToSlack('Send-worker: lead mailbox differed after first-send lock attempt', {
        severity: 'warning',
        campaign_id: messageJob.campaign_id,
        enrollment_id: messageJob.enrollment_id,
        lead_id: messageJob.lead_id,
        message_job_id: messageJob.id,
        error: `Lead mailbox ${currentLead?.mailbox_id ?? 'NULL'} did not match sent job mailbox ${messageJob.mailbox_id}.`,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-post-lock-mismatch:${messageJob.campaign_id}:${messageJob.lead_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
        },
      });
    }
  }

  private async deferCampaignMessageJobForPause(messageJob: MessageJob): Promise<void> {
    const now = new Date().toISOString();

    await this.supabase
      .from('message_jobs')
      .update({
        status: 'deferred',
        status_reason: 'campaign_paused',
        reserved_at: null,
        send_wait_reason: null as any,
        error_message: null,
        updated_at: now,
      } as any)
      .eq('id', messageJob.id)
      .eq('status', 'reserved');

    await this.supabase
      .from('enrollments')
      .update({
        next_run_at: null,
        updated_at: now,
      })
      .eq('id', messageJob.enrollment_id)
      .eq('state', 'active');
  }

  private async deferCampaignMessageJobForEnrollmentPause(messageJob: MessageJob): Promise<void> {
    const now = new Date().toISOString();

    await this.supabase
      .from('message_jobs')
      .update({
        status: 'deferred',
        status_reason: 'enrollment_paused',
        reserved_at: null,
        send_wait_reason: null as any,
        error_message: null,
        updated_at: now,
      } as any)
      .eq('id', messageJob.id)
      .in('status', ['queued', 'reserved']);
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
        `[SEND WORKER] Throttle check deferred ${jobLabel} ${messageJobId}: ${fr}.`
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
    // Campaign (or null/legacy): continue with campaign send flow.
    // Priority jobs (campaign_priority / legacy campaign_reply) ride the same
    // subject/threading path as paced campaign sends; they only differ in
    // claim lane, throttle retry, and immediate Master Inbox recording.
    const isPriorityJob = isPriorityCampaignJob(messageJob);

    let enteredSending = false;
    let campaignSchedule: CampaignSchedule | null = null;

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
        .select('account_id, status, deleted_at, schedule, name')
        .eq('id', messageJob.campaign_id)
        .single();

      campaignSchedule = (campaign?.schedule ?? null) as CampaignSchedule | null;

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
      if (campaign.status === 'paused') {
        console.log(
          `[SEND WORKER] Campaign ${messageJob.campaign_id} is paused. Deferring reserved attempt ${message_job_id} back to scheduler ownership.`,
        );
        await this.deferCampaignMessageJobForPause(messageJob);
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
          .select('deleted_at, state')
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
      const enrollmentState = (enrollmentResult.data as { state?: string } | null)?.state;
      if (enrollmentState === 'paused') {
        console.log(
          `[SEND WORKER] Enrollment ${messageJob.enrollment_id} is paused; deferring campaign job ${message_job_id}.`,
        );
        await this.deferCampaignMessageJobForEnrollmentPause(messageJob);
        return;
      }
      if (enrollmentState && enrollmentState !== 'active') {
        console.log(
          `[SEND WORKER] Enrollment ${messageJob.enrollment_id} is ${enrollmentState}; cancelling campaign job ${message_job_id} without mutating enrollment`
        );
        await this.cancelMessageJob(message_job_id, `Enrollment not active (${enrollmentState})`);
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
          await this.blockCampaignMessageJob(messageJob, 'Lead blocked', 'lead_blocked');
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
        if (isPriorityJob) {
          const requeued = await this.promoteCampaignReplyThrottleRetry(
            messageJob,
            campaignSchedule,
            result?.failure_reason,
          );
          if (requeued) {
            console.log(
              `[SEND WORKER] Re-queued priority job ${message_job_id} on the priority lane after throttle deferral: ${result?.failure_reason ?? 'unknown reason'}.`
            );
          } else {
            this.logThrottleCheckOutcome('priority campaign job', message_job_id, result?.failure_reason);
          }
          return;
        }
        this.logThrottleCheckOutcome('message job', message_job_id, result?.failure_reason);
        return;
      }

      const { data: currentCampaign, error: currentCampaignError } = await this.supabase
        .from('campaigns')
        .select('status')
        .eq('id', messageJob.campaign_id)
        .single();

      if (currentCampaignError) {
        throw new CampaignAttemptError(
          `Failed to reload campaign status before sending: ${currentCampaignError.message}`,
          'provider_error',
        );
      }

      if (currentCampaign?.status === 'paused') {
        console.log(
          `[SEND WORKER] Campaign ${messageJob.campaign_id} paused before SMTP send. Deferring reserved attempt ${message_job_id}.`,
        );
        await this.deferCampaignMessageJobForPause(messageJob);
        return;
      }

      const markedSending = await this.markMessageJobSendingIfReserved(message_job_id);
      if (!markedSending) {
        console.log(
          `[SEND WORKER] Message job ${message_job_id} left reserved state before SMTP send; skipping.`
        );
        return;
      }
      enteredSending = true;

      // Throttle check passed - proceed with sending

      // 2b. Full conversation timeline (prior sends + inbound replies) so the
      //     shared resolver can pick the subject epoch and immediate parent.
      let timeline: ThreadTimelineEntry[];
      try {
        timeline = await this.loadThreadTimelineForJob({
          campaignId: messageJob.campaign_id,
          leadId: messageJob.lead_id,
          threadId: (messageJob.message_data as any)?.thread_id ?? null,
          lead: lead as unknown as LeadLike,
        });
      } catch (err) {
        const msg = formatUnknownError(err);
        reportErrorToSlack('Send-worker: failed to load thread timeline for outbound threading', {
          severity: 'warning',
          message_job_id: message_job_id,
          campaign_id: messageJob.campaign_id,
          error: msg,
          alertPolicy: 'persistent_config_warning',
          aggregationKey: `send-worker-thread-timeline:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
        throw err;
      }

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
            editor_mode: nodeConfig.editor_mode,
            signature: mailbox.signature ?? undefined,
          },
          lead as unknown as LeadLike,
          {
            seed: buildSpintaxSeed({
              campaignId: messageJob.campaign_id,
              leadId: messageJob.lead_id,
              // Historical jobs may lack variant_id; buildSpintaxSeed uses a
              // stable legacy stand-in so retries stay consistent.
              variantId: messageJob.variant_id,
            }),
          }
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
        throw new CampaignAttemptError(msg, 'template_render_error');
      }
      const currentSubject = content.subject;
      const emailBody = content.bodyMerged;
      const isHtmlBody = content.isHtmlBody;
      const emailBodyText = content.bodyText;

      // Subject and RFC ancestry come from the one shared resolver, so campaign
      // sends, priority replies, and manual replies cannot drift apart.
      let threading: OutboundThreadingContext;
      try {
        threading = resolveOutboundThreading({
          subjectTemplate: nodeConfig.subject ?? nodeConfig.template ?? '',
          renderedSubject: currentSubject,
          timeline,
          lead: lead as unknown as LeadLike,
        });
      } catch (err) {
        const msg = formatUnknownError(err);
        reportErrorToSlack('Send-worker: outbound threading resolution failed', {
          severity: 'warning',
          message_job_id: message_job_id,
          campaign_id: messageJob.campaign_id,
          error: msg,
          alertPolicy: 'persistent_config_warning',
          aggregationKey: `send-worker-threading-resolve:${messageJob.campaign_id}`,
          summaryFields: {
            campaign_id: messageJob.campaign_id,
          },
        });
        throw err;
      }

      const subject = threading.subject;
      const inReplyTo = threading.inReplyTo;
      const references = threading.references;
      const referenceMessageIds =
        threading.referenceMessageIds.length > 0 ? threading.referenceMessageIds : null;
      const threadTopic = threading.threadTopic;
      const submittedMessageId = buildStableSubmittedMessageId(message_job_id);

      // Surface where the resolver changed real behavior, so a rollout can be
      // watched rather than guessed at.
      const divergence = describeLegacyThreadingDivergence({
        timeline,
        renderedSubject: currentSubject,
        lead: lead as unknown as LeadLike,
        resolved: threading,
      });
      if (divergence) {
        console.log(
          `[SEND WORKER] Threading resolver changed outcome for job ${message_job_id} ` +
            `(decision=${threading.decision}): ${JSON.stringify(divergence)}`,
        );
      }

      // Check if this is a test mode job (skip SMTP sending)
      // Test mailboxes are identified by @furnace.test email domain
      const isTestMailbox = mailbox.email_address.endsWith('@furnace.test');
      const skipSmtp = isTestMailbox || (messageJob.message_data as any)?.skip_smtp === true;
      let sendResult: SendEmailResult;

      if (skipSmtp) {
        // Test mode: Skip SMTP sending, reuse stable submitted ID as provider ID
        const testReason = isTestMailbox 
          ? `test mailbox detected (${mailbox.email_address})`
          : 'skip_smtp flag set';
        console.log(`[TEST MODE] Processing message job ${message_job_id} (SMTP sending skipped - ${testReason})`);
        sendResult = {
          submittedMessageId,
          providerMessageId: submittedMessageId,
        };
      } else {
        // Production mode: Send via SMTP
        console.log(`[SEND WORKER] Sending email via SMTP for message job ${message_job_id}`);
        // 4. Get SMTP transporter from pool (reuses connection if available)
        const transporter = await this.smtpPool.getTransporter(mailbox);

        try {
          // 5. Send email (with optional threading headers for follow-ups)
          const rawSendResult = await this.campaignEmailSender(
            transporter,
            mailbox,
            messageJob,
            lead,
            subject,
            emailBody,
            inReplyTo,
            references,
            {
              messageId: submittedMessageId,
              threadTopic,
              ...(isHtmlBody
                ? { bodyHtml: emailBody, bodyText: emailBodyText ?? undefined }
                : emailBodyText
                  ? { bodyText: emailBodyText }
                  : {}),
            },
          );
          // Tests/harnesses may still return a bare Message-ID string.
          sendResult = normalizeCampaignSendResult(rawSendResult, submittedMessageId);
          
          // Mark message sent (for maxMessages tracking)
          this.smtpPool.markMessageSent(mailbox.id);
          
          console.log(`[SEND WORKER] Email sent successfully for message job ${message_job_id} (provider_message_id: ${sendResult.providerMessageId})`);
        } catch (error: any) {
          // On connection/auth errors, remove transporter from cache so it gets recreated
          if (error.code === 'EAUTH' || error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.error(`[SEND WORKER] SMTP connection error for mailbox ${mailbox.id}, removing from pool:`, error);
            this.smtpPool.removeTransporter(mailbox.id);
          }
          await this.markMailboxSmtpFailureIfPermanent(mailbox.id, error);
          throw new CampaignAttemptError(formatUnknownError(error), 'provider_error');
        }
      }

      const providerMessageId = sendResult.providerMessageId;

      // 6. Atomically finalize sent state and mailbox throttle accounting.
      await this.finalizeCampaignMessageJobSent(
        message_job_id,
        providerMessageId,
        sendResult.submittedMessageId,
      );
      await this.persistSentThreadingMetadataOnMessageJob(
        messageJob,
        {
          subject,
          inReplyTo,
          references,
          referenceMessageIds,
          threadTopic,
          submittedMessageId: sendResult.submittedMessageId,
          threadingDecision: threading.decision,
          parentEmailMessageId: threading.parentEmailMessageId,
          conversationRootMessageId:
            threading.conversationRootMessageId ??
            normalizeMessageId(providerMessageId) ??
            normalizeMessageId(sendResult.submittedMessageId),
        },
        accountId,
      );

      await this.reconcileLeadMailboxAfterSuccessfulSend(messageJob, lead.mailbox_id);

      // 6a. Throttle counters were committed atomically with final sent status.

      // 6a-bis. Priority jobs: record the sent email in the thread so the
      // master inbox shows it immediately. Best-effort: the email is already sent.
      if (isPriorityJob) {
        await this.recordCampaignReplyInThread(
          messageJob,
          mailbox,
          lead,
          subject,
          isHtmlBody ? emailBody : null,
          isHtmlBody ? (emailBodyText ?? '') : emailBody,
          providerMessageId,
          inReplyTo,
          references,
          referenceMessageIds,
          threadTopic,
        );
      }

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

      // 7. Interval completion is now maintained by message_jobs trigger-backed counters.
      // Create the sent event and campaign stats after the terminal status write.
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
        await emitWebhookEvent(this.supabase, {
          accountId: accountId,
          campaignId: messageJob.campaign_id,
          eventType: 'email.sent',
          payload: buildEmailSentWebhookPayload({
            campaignId: messageJob.campaign_id,
            campaignName: campaign.name ?? null,
            leadId: messageJob.lead_id,
            email: lead.email,
            enrollmentId: messageJob.enrollment_id,
            messageJobId: messageJob.id,
            mailboxId: messageJob.mailbox_id,
            mailboxEmail: mailbox.email_address,
            providerMessageId,
            sentAt: eventData.sent_at,
            subject,
          }),
          dedupeKey: `email.sent:${messageJob.id}`,
        });
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
      
      const errorMessage = formatUnknownError(error);
      const retryableJobError = isRetryableSupabaseReadError(errorMessage);
      const statusReason =
        error instanceof CampaignAttemptError
          ? error.statusReason
          : retryableJobError && enteredSending
            ? 'uncertain_send_state'
            : 'provider_error';
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

      if (retryableJobError && isCampaignMessageJob(messageJob) && !enteredSending) {
        try {
          const deferred = isPriorityJob
            ? await this.requeueCampaignReplyJob(messageJob, campaignSchedule, {
                retryFloor: new Date(Date.now() + 60_000),
                sendWaitReason: null,
                errorMessage,
              })
            : await this.deferCampaignMessageJobForRetryableError(messageJob, errorMessage);
          if (deferred) {
            console.log(
              isPriorityJob
                ? `[SEND WORKER] Re-queued retryable pre-send failure for priority job ${messageJob.id}`
                : `[SEND WORKER] Deferred retryable pre-send failure for message job ${messageJob.id}`
            );
          } else {
            console.log(
              `[SEND WORKER] Retryable pre-send failure for message job ${messageJob.id} left unchanged because it was no longer reserved`
            );
          }
          return;
        } catch (requeueError) {
          const requeueMessage = formatUnknownError(requeueError);
          console.error(
            `[SEND WORKER] Failed to defer retryable message job ${messageJob.id}:`,
            requeueError
          );
          reportErrorToSlack('Send-worker: failed to defer retryable pre-send message job', {
            severity: 'warning',
            message_job_id: messageJob.id,
            enrollment_id: messageJob.enrollment_id,
            campaign_id: messageJob.campaign_id,
            error: requeueMessage,
            alertPolicy: isRetryableSupabaseReadError(requeueMessage)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `send-worker-requeue-retryable:${messageJob.campaign_id}`,
            summaryFields: {
              campaign_id: messageJob.campaign_id,
            },
          });
          return;
        }
      }
      
      try {
        await this.failCampaignMessageJob(messageJob, errorMessage, statusReason);
        
        console.log(`[SEND WORKER] Marked message job ${messageJob.id} as failed`);

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
   * Record a sent campaign_reply in its replied thread and repair any stale
   * thread counters if a prior best-effort write partially succeeded.
   */
  private async recordCampaignReplyInThread(
    messageJob: MessageJob,
    mailbox: Mailbox,
    lead: Lead,
    subject: string,
    bodyHtml: string | null,
    bodyText: string,
    providerMessageId: string,
    inReplyTo: string | null,
    references: string | null,
    referenceMessageIds: string[] | null = null,
    threadTopic: string | null = null,
  ): Promise<void> {
    const threadId = (messageJob.message_data || {}).thread_id;
    if (!threadId) {
      reportErrorToSlack('Send-worker: campaign_reply job missing thread_id (sent reply not recorded in thread)', {
        severity: 'warning',
        message_job_id: messageJob.id,
        campaign_id: messageJob.campaign_id,
        enrollment_id: messageJob.enrollment_id,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-campaign-reply-thread:${messageJob.campaign_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
        },
      });
      return;
    }

    try {
      await this.recordSentMessageInThread({
        threadId,
        messageJobId: messageJob.id,
        fromEmail: mailbox.email_address,
        fromName: mailbox.display_name ?? null,
        toEmail: lead.email,
        toName:
          lead.first_name || lead.last_name
            ? `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim()
            : null,
        subject,
        bodyText: bodyText,
        bodyHtml,
        messageId: providerMessageId,
        inReplyTo,
        references,
        referenceMessageIds,
        threadTopic,
        receivedAt: new Date().toISOString(),
      });
    } catch (error) {
      const msg = formatUnknownError(error);
      console.error(`[SEND WORKER] Failed to record campaign_reply ${messageJob.id} in thread ${threadId}:`, error);
      reportErrorToSlack('Send-worker: failed to record sent campaign_reply in thread (master inbox may be missing the reply)', {
        severity: 'warning',
        message_job_id: messageJob.id,
        campaign_id: messageJob.campaign_id,
        thread_id: threadId,
        error: msg,
        alertPolicy: isRetryableSupabaseReadError(msg)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `send-worker-campaign-reply-record:${messageJob.campaign_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
        },
      });
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

    const markedSending = await this.markMessageJobSendingIfReserved(message_job_id);
    if (!markedSending) {
      console.log(
        `[SEND WORKER] Reply job ${message_job_id} left reserved state before SMTP send; skipping.`
      );
      return;
    }

    // 3. Send reply via SMTP
    const transporter = await this.smtpPool.getTransporter(mailbox as Mailbox);
    const rawAttachments = Array.isArray(md.attachments) ? md.attachments : [];
    const fileAttachments = await resolveSendAttachments(this.supabase, rawAttachments);
    console.log(`[SEND WORKER] Reply job ${message_job_id} attachments: ${fileAttachments.length} (raw: ${rawAttachments.length})`);
    // Recompute ancestry at send time from the same resolver the campaign lane
    // uses, parenting the message the user selected in the composer.
    const replyThreading = resolveOutboundThreading({
      subjectTemplate: md.subject ?? '',
      renderedSubject: md.subject ?? '',
      timeline: await this.loadThreadTimelineForJob({ threadId }),
      explicitParentWireId: md.in_reply_to ?? null,
    });
    const replyRefIds =
      replyThreading.referenceMessageIds.length > 0
        ? replyThreading.referenceMessageIds
        : Array.isArray(md.reference_message_ids)
          ? md.reference_message_ids
          : parseMessageIds(md.message_references ?? null);
    const replyThreadTopic =
      (typeof md.thread_topic === 'string' && md.thread_topic) ||
      replyThreading.threadTopic ||
      normalizeThreadTopic(md.subject || null);
    const replyOptions: ReplyEmailOptions = {
      toEmail: md.to_email || '',
      toName: md.to_name ?? null,
      cc: Array.isArray(md.cc) ? md.cc : undefined,
      subject: md.subject || '',
      bodyText: md.body_text || md.body_html || '',
      bodyHtml: md.body_html ?? null,
      inReplyTo: replyThreading.inReplyTo ?? md.in_reply_to ?? null,
      references:
        replyThreading.references ?? md.message_references ?? formatReferencesHeader(replyRefIds),
      threadTopic: replyThreadTopic,
      messageId: buildStableSubmittedMessageId(message_job_id),
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
    let sendResult: SendEmailResult;
    try {
      sendResult = await sendReplyEmail(transporter, mailbox as Mailbox, messageJob, replyOptions);
      this.smtpPool.markMessageSent(mailbox.id);
    } catch (err: any) {
      if (err.code === 'EAUTH' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT') {
        this.smtpPool.removeTransporter(mailbox.id);
      }
      await this.markMailboxSmtpFailureIfPermanent(mailbox.id, err);
      throw err;
    }
    const providerMessageId = sendResult.providerMessageId;

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

    // Build attachment metadata for email_messages (filename, contentType, size, storagePath)
    const replyAttachmentMeta =
      fileAttachments.length > 0
        ? buildSentAttachmentMetadata(fileAttachments)
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
        to_emails: replyOptions.toEmail?.trim() ? [replyOptions.toEmail.trim()] : null,
        cc: replyOptions.cc && replyOptions.cc.length > 0 ? replyOptions.cc : null,
        subject: replyOptions.subject,
        body_text: replyOptions.bodyText,
        body_html: replyOptions.bodyHtml,
        message_id: normalizeMessageId(providerMessageId),
        in_reply_to: normalizeMessageId(replyOptions.inReplyTo),
        message_references: replyOptions.references,
        reference_message_ids: replyRefIds,
        thread_topic: replyThreadTopic,
        received_at: now,
        attachments: replyAttachmentMeta,
      });
    if (insertError) {
      throw new Error(`Failed to insert email_messages for reply: ${insertError.message}`);
    }

    await markAttachmentUploadsSent(this.supabase, fileAttachments);

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
        status_reason: 'sent_successfully',
        sent_at: now,
        provider_message_id: providerMessageId,
        submitted_message_id: sendResult.submittedMessageId,
        updated_at: now,
      })
      .eq('id', message_job_id);

    console.log(`[SEND WORKER] Inbox reply job ${message_job_id} sent successfully`);
  }

  /**
   * Process an inbox forward job: send forward email to new recipients and
   * persist the sent message into the existing thread.
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

    const markedSending = await this.markMessageJobSendingIfReserved(message_job_id);
    if (!markedSending) {
      console.log(
        `[SEND WORKER] Forward job ${message_job_id} left reserved state before SMTP send; skipping.`
      );
      return;
    }

    // 3. Send forward via SMTP (no In-Reply-To/References)
    const transporter = await this.smtpPool.getTransporter(mailbox as Mailbox);
    const rawForwardAttachments = Array.isArray(md.attachments) ? md.attachments : [];
    const forwardFileAttachments = await resolveSendAttachments(this.supabase, rawForwardAttachments);
    console.log(`[SEND WORKER] Forward job ${message_job_id} attachments: ${forwardFileAttachments.length} (raw: ${rawForwardAttachments.length})`);
    const forwardOptions: ReplyEmailOptions = {
      toEmail: md.to_email || '',
      toName: md.to_name ?? null,
      cc: Array.isArray(md.cc) ? md.cc : undefined,
      subject: md.subject || '',
      bodyText: md.body_text || md.body_html || '',
      bodyHtml: md.body_html ?? null,
      inReplyTo: null,
      references: null,
      messageId: buildStableSubmittedMessageId(message_job_id),
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
    let sendResult: SendEmailResult;
    try {
      sendResult = await sendReplyEmail(transporter, mailbox as Mailbox, messageJob, forwardOptions);
      this.smtpPool.markMessageSent(mailbox.id);
    } catch (err: any) {
      if (err.code === 'EAUTH' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT') {
        this.smtpPool.removeTransporter(mailbox.id);
      }
      await this.markMailboxSmtpFailureIfPermanent(mailbox.id, err);
      throw err;
    }
    const providerMessageId = sendResult.providerMessageId;

    const forwardAttachmentMeta =
      forwardFileAttachments.length > 0
        ? buildSentAttachmentMetadata(forwardFileAttachments)
        : [];

    const now = new Date().toISOString();
    await this.recordSentMessageInThread({
      threadId,
      messageJobId: message_job_id,
      fromEmail: mailbox.email_address,
      fromName: mailbox.display_name ?? null,
      toEmail: forwardOptions.toEmail,
      toName: forwardOptions.toName ?? null,
      cc: forwardOptions.cc ?? null,
      subject: forwardOptions.subject,
      bodyText: forwardOptions.bodyText,
      bodyHtml: forwardOptions.bodyHtml ?? null,
      messageId: providerMessageId,
      inReplyTo: null,
      references: null,
      receivedAt: now,
      attachments: forwardAttachmentMeta,
    });

    await markAttachmentUploadsSent(this.supabase, forwardFileAttachments);

    // 4. Mark message_job sent after thread persistence succeeds
    await this.supabase
      .from('message_jobs')
      .update({
        status: 'sent',
        status_reason: 'sent_successfully',
        sent_at: now,
        provider_message_id: providerMessageId,
        submitted_message_id: sendResult.submittedMessageId,
        updated_at: now,
      })
      .eq('id', message_job_id);

    console.log(`[SEND WORKER] Inbox forward job ${message_job_id} sent successfully`);
  }

  /**
   * Conversation timeline for one job. Wrapped as a method so tests and
   * harnesses can supply a timeline without standing up both tables.
   */
  private async loadThreadTimelineForJob(params: {
    campaignId?: string | null;
    leadId?: string | null;
    threadId?: string | null;
    lead?: LeadLike | null;
  }): Promise<ThreadTimelineEntry[]> {
    return loadThreadTimeline({ supabase: this.supabase, ...params });
  }

  private async persistSentThreadingMetadataOnMessageJob(
    messageJob: MessageJob,
    meta: {
      subject: string;
      inReplyTo: string | null;
      references: string | null;
      referenceMessageIds: string[] | null;
      threadTopic: string | null;
      submittedMessageId: string;
      threadingDecision?: ThreadingDecision;
      parentEmailMessageId?: string | null;
      conversationRootMessageId?: string | null;
    },
    accountId?: string | null,
  ): Promise<void> {
    const existing =
      messageJob.message_data && typeof messageJob.message_data === 'object'
        ? messageJob.message_data
        : {};
    const nextMessageData: MessageJob['message_data'] = {
      ...existing,
      sent_subject: meta.subject,
      in_reply_to: meta.inReplyTo ?? undefined,
      message_references: meta.references ?? undefined,
      reference_message_ids: meta.referenceMessageIds ?? undefined,
      thread_topic: meta.threadTopic ?? undefined,
      submitted_message_id: meta.submittedMessageId,
      threading_decision: meta.threadingDecision ?? undefined,
      parent_email_message_id: meta.parentEmailMessageId ?? undefined,
      conversation_root_message_id: meta.conversationRootMessageId ?? undefined,
    };
    let copyRenderingId: string | null = null;
    try {
      copyRenderingId = await stampCopyRenderingId({
        db: this.supabase,
        accountId,
        messageJob,
      });
    } catch (error) {
      console.error(
        `[SEND WORKER] Failed to resolve copy rendering for message job ${messageJob.id}:`,
        error,
      );
    }
    const updates: Record<string, unknown> = { message_data: nextMessageData };
    if (copyRenderingId) {
      updates.copy_rendering_id = copyRenderingId;
    }
    const { error } = await this.supabase
      .from('message_jobs')
      .update(updates)
      .eq('id', messageJob.id);

    if (error) {
      console.error(
        `[SEND WORKER] Failed to persist sent threading metadata on message job ${messageJob.id}:`,
        error,
      );
      reportErrorToSlack('Send-worker: failed to persist sent_subject on message_jobs.message_data', {
        severity: 'warning',
        message_job_id: messageJob.id,
        campaign_id: messageJob.campaign_id,
        error: error.message,
        alertPolicy: 'persistent_config_warning',
        aggregationKey: `send-worker-persist-sent-subject:${messageJob.campaign_id}`,
        summaryFields: {
          campaign_id: messageJob.campaign_id,
        },
      });
    } else {
      messageJob.message_data = nextMessageData;
      if (copyRenderingId) {
        messageJob.copy_rendering_id = copyRenderingId;
      }
    }
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

