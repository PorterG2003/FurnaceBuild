import { SupabaseClient } from '@supabase/supabase-js';
import { DatabaseClient } from './database.js';
import { sendEmail, mergeTemplate } from './email.js';
import { SmtpPool } from './smtp-pool.js';
import type { MessageJob, Mailbox, Lead } from './types.js';

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
        // Poll database for message jobs ready to send
        const messageJobs = await this.databaseClient.poll();

        if (messageJobs.length > 0) {
          this.consecutiveEmptyPolls = 0;
          console.log(`[SEND WORKER] Found ${messageJobs.length} message job(s) ready to send`);

          // Process jobs in parallel (with concurrency limit if needed)
          const results = await Promise.allSettled(
            messageJobs.map(job => this.processMessageJob(job))
          );

          // Log results
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          console.log(`[SEND WORKER] Processed ${messageJobs.length} job(s): ${successful} successful, ${failed} failed`);

          // Log any failures
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error(`[SEND WORKER] Failed to process message job ${messageJobs[index].id}:`, result.reason);
            }
          });
        } else {
          // No jobs found - adaptive polling: increase interval when idle
          this.consecutiveEmptyPolls++;
          const pollInterval = this.calculatePollInterval();
          await this.sleep(pollInterval);
        }
      } catch (error) {
        console.error('[SEND WORKER] Error in main loop:', error);
        // Wait before retrying
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
    try {
      const message_job_id = messageJob.id;

      console.log(`[SEND WORKER] Processing message job: ${message_job_id}`);

      // Job is already claimed (status = 'reserved') and scheduled_at <= NOW() is guaranteed by RPC function
      // No need to check scheduled_at or load from database again

      // 1. Load related data (lead, mailbox, node config)
      const { lead, mailbox, nodeConfig } = await this.loadJobData(messageJob);

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

      // 3. Generate email content from template
      const subject = mergeTemplate(nodeConfig.subject || '', lead);
      const emailBody = mergeTemplate(nodeConfig.body || '', lead);

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
          // 5. Send email
          providerMessageId = await sendEmail(
            transporter,
            mailbox,
            messageJob,
            lead,
            subject,
            emailBody
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
            test_mode: skipSmtp, // Mark as test mode in event data
          },
        });

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

        // Check if interval should be marked as processed (immediate, not waiting for scheduler timer)
        // This makes interval completion happen immediately instead of waiting up to 1 minute
        try {
          const { data: processedCount, error: processedError } = await this.supabase
            .rpc('check_and_update_processed_intervals', {
              p_campaign_id: messageJob.campaign_id
            });
          
          if (processedError) {
            // Log error but don't fail (job is already marked as failed)
            console.error(`[SEND WORKER] Failed to check processed intervals for campaign ${messageJob.campaign_id}:`, processedError);
          } else if (processedCount && processedCount > 0) {
            console.log(`[SEND WORKER] Marked ${processedCount} interval(s) as processed for campaign ${messageJob.campaign_id}`);
          }
        } catch (processedCheckError) {
          // Log error but don't fail (job is already marked as failed)
          console.error(`[SEND WORKER] Error checking processed intervals for campaign ${messageJob.campaign_id}:`, processedCheckError);
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
}

