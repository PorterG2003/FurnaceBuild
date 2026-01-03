import { SupabaseClient } from '@supabase/supabase-js';
import { DatabaseClient } from './database.js';
import { createTransporter, sendEmail, mergeTemplate } from './email.js';
import type { MessageJob, Mailbox, Lead } from './types.js';

export interface WorkerConfig {
  supabase: SupabaseClient;
  databaseClient: DatabaseClient;
}

export class SendWorker {
  private supabase: SupabaseClient;
  private databaseClient: DatabaseClient;
  private running: boolean = false;
  private consecutiveEmptyPolls: number = 0;
  private readonly maxEmptyPolls: number = 10;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.databaseClient = config.databaseClient;
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
  stop(): void {
    console.log('Stopping send worker...');
    this.running = false;
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

      // 1. TODO: Reserve job (atomic throttle check)
      // For now, we'll skip throttling and proceed
      // const reserved = await this.reserveMessageJob(messageJob);
      // if (!reserved) {
      //   // Throttle limit hit, mark job for retry/reschedule
      //   return;
      // }

      // 2. Load related data (lead, mailbox, node config)
      const { lead, mailbox, nodeConfig } = await this.loadJobData(messageJob);

      // 3. Generate email content from template
      const subject = mergeTemplate(nodeConfig.subject || '', lead);
      const emailBody = mergeTemplate(nodeConfig.body || '', lead);

      // Check if this is a test mode job (skip SMTP sending)
      const skipSmtp = (messageJob.message_data as any)?.skip_smtp === true;
      let providerMessageId: string;

      if (skipSmtp) {
        // Test mode: Skip SMTP sending, generate fake message ID
        console.log(`[TEST MODE] Processing message job ${message_job_id} (SMTP sending skipped)`);
        providerMessageId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 15)}@furnace.test`;
      } else {
        // Production mode: Send via SMTP
        console.log(`[SEND WORKER] Sending email via SMTP for message job ${message_job_id}`);
        // 4. Create SMTP transporter
        const transporter = createTransporter(mailbox);

        // 5. Send email
        providerMessageId = await sendEmail(
          transporter,
          mailbox,
          messageJob,
          lead,
          subject,
          emailBody
        );
        console.log(`[SEND WORKER] Email sent successfully for message job ${message_job_id} (provider_message_id: ${providerMessageId})`);
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
      // TODO: Implement retry logic with exponential backoff
      // TODO: Mark job as failed after max retries
      throw error; // Re-throw to be caught by Promise.allSettled
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
   * TODO: Implement atomic job reservation with throttle checking
   */
  private async reserveMessageJob(messageJob: MessageJob): Promise<boolean> {
    // This will call a Supabase function to atomically:
    // 1. Check throttle limits
    // 2. Reserve the job (update status to 'reserved')
    // 3. Update throttle counters
    // Returns true if reserved, false if throttle limit hit
    // 
    // For now, we'll skip this and implement it in Phase 4 (Pacing & Throttling)
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

