import { SupabaseClient } from '@supabase/supabase-js';
import { buildCampaignEmailContent, type LeadLike } from '@furnace/email-lib';
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

      // 1b. Block list check — skip campaign sends to blocked addresses
      const { data: campaign } = await this.supabase
        .from('campaigns')
        .select('account_id, status')
        .eq('id', messageJob.campaign_id)
        .single();

      if (!campaign || campaign.status !== 'running') {
        console.log(`[SEND WORKER] Campaign ${messageJob.campaign_id} is not running. Cancelling message job ${message_job_id}.`);
        await this.supabase
          .from('message_jobs')
          .update({
            status: 'cancelled',
            error_message: `Campaign status is ${campaign?.status || 'unknown'}`,
          })
          .eq('id', message_job_id);
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
        // Throttle check failed - job already cancelled by RPC function
        const failureReason = result?.failure_reason || 'Unknown throttle failure';
        console.log(`[SEND WORKER] Throttle check failed for message job ${message_job_id}: ${failureReason}`);
        return; // Skip this job, continue to next
      }

      // Throttle check passed - proceed with sending

      // 2b. Get first sent message for this campaign+lead (for thread continuation)
      const threadFirst = await this.getFirstSentMessageForCampaignLead(messageJob.campaign_id, messageJob.lead_id);

      // 3. Generate email content from template (shared pipeline with preview)
      const content = buildCampaignEmailContent(
        {
          subject: nodeConfig.subject,
          body_html: nodeConfig.body_html,
          body_text: nodeConfig.body_text,
          template: nodeConfig.template,
          body: nodeConfig.body,
        },
        lead as unknown as LeadLike,
        { deterministic: false }
      );
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
          const firstContent = buildCampaignEmailContent(
            firstConfig,
            lead as unknown as LeadLike,
            { deterministic: false }
          );
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
        } else {
          console.log(`[SEND WORKER] Updated enrollment ${messageJob.enrollment_id} next_run_at to trigger scheduler re-evaluation`);
        }
      } catch (error) {
        // Log error but don't fail the send
        console.error(`[SEND WORKER] Error updating enrollment ${messageJob.enrollment_id}:`, error);
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
        } else if (processedCount && processedCount > 0) {
          console.log(`[SEND WORKER] Marked ${processedCount} interval(s) as processed for campaign ${messageJob.campaign_id}`);
        }
      } catch (error) {
        // Log error but don't fail the send
        console.error(`[SEND WORKER] Error checking processed intervals for campaign ${messageJob.campaign_id}:`, error);
      }

      // 7. Create event record
      await this.supabase
        .from('events')
        .insert({
          campaign_id: messageJob.campaign_id,
          lead_id: messageJob.lead_id,
          enrollment_id: messageJob.enrollment_id,
          message_job_id: messageJob.id,
          event_type: 'sent',
          event_data: {
            provider_message_id: providerMessageId,
            sent_at: new Date().toISOString(),
            test_mode: skipSmtp,
            sent_subject: subject,
            sent_body_html: emailBody,
            sent_body_text: emailBodyText,
          },
        });

      // 7b. Update campaign_stats.sent_count (campaign sends only; skip inbox_reply/inbox_forward)
      if (isCampaignMessageJob(messageJob)) {
        const campaignId = messageJob.campaign_id;
        let statsError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { error } = await this.supabase.rpc('increment_campaign_stats_sent', {
            p_campaign_id: campaignId,
          });
          if (!error) break;
          statsError = error;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
          }
        }
        if (statsError) {
          console.error(`[SEND WORKER] Failed to increment campaign_stats.sent_count for campaign ${campaignId} after retries:`, statsError);
        }
      }

      if (skipSmtp) {
        console.log(`[TEST MODE] Successfully processed message job ${message_job_id} (no email sent)`);
      } else {
        console.log(`[SEND WORKER] Successfully processed message job ${message_job_id}`);
      }

    } catch (error) {
      console.error(`[SEND WORKER] Error processing message job ${messageJob.id}:`, error);
      
      // Mark job as failed with error message
      const errorMessage = error instanceof Error 
        ? error.message 
        : String(error);
      
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
      // Manual sends: do not leave job cancelled; re-queue so it retries when throttle allows
      console.log(`[SEND WORKER] Throttle check failed for reply job ${message_job_id}: ${result?.failure_reason}. Re-queuing for retry.`);
      const { error: updateError } = await this.supabase
        .from('message_jobs')
        .update({
          status: 'pending',
          reserved_at: null,
          error_message: null,
        })
        .eq('id', message_job_id);
      if (updateError) {
        console.error(`[SEND WORKER] Failed to re-queue reply job ${message_job_id}:`, updateError);
      }
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

    // 4. Load thread for participants and current counts
    const { data: thread, error: threadError } = await this.supabase
      .from('email_threads')
      .select('participants, message_count')
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
      console.log(`[SEND WORKER] Throttle check failed for forward job ${message_job_id}: ${result?.failure_reason}. Re-queuing for retry.`);
      const { error: updateError } = await this.supabase
        .from('message_jobs')
        .update({
          status: 'pending',
          reserved_at: null,
          error_message: null,
        })
        .eq('id', message_job_id);
      if (updateError) {
        console.error(`[SEND WORKER] Failed to re-queue forward job ${message_job_id}:`, updateError);
      }
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

