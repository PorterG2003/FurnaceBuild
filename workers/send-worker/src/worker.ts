import { SupabaseClient } from '@supabase/supabase-js';
import { QueueClient } from './queue';
import { createTransporter, sendEmail, mergeTemplate } from './email';
import type { MessageJob, Mailbox, Lead, SQSMessage } from './types';

export interface WorkerConfig {
  supabase: SupabaseClient;
  queueClient: QueueClient;
}

export class SendWorker {
  private supabase: SupabaseClient;
  private queueClient: QueueClient;
  private running: boolean = false;

  constructor(config: WorkerConfig) {
    this.supabase = config.supabase;
    this.queueClient = config.queueClient;
  }

  /**
   * Start the worker (main loop)
   */
  async start(): Promise<void> {
    console.log('Send worker starting...');
    this.running = true;

    while (this.running) {
      try {
        // Poll queue for messages
        const messages = await this.queueClient.poll();

        if (messages.length > 0) {
          console.log(`Received ${messages.length} messages from queue`);

          // Process messages in parallel (with concurrency limit if needed)
          await Promise.all(
            messages.map(msg => this.processMessage(msg))
          );
        }
      } catch (error) {
        console.error('Error in worker main loop:', error);
        // Wait before retrying
        await this.sleep(5000);
      }
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
   * Process a single message from SQS
   */
  private async processMessage(sqsMessage: any): Promise<void> {
    let receiptHandle: string | undefined;

    try {
      // Parse message body
      const body: SQSMessage = JSON.parse(sqsMessage.Body);
      receiptHandle = sqsMessage.ReceiptHandle;

      const { message_job_id } = body;

      console.log(`Processing message job: ${message_job_id}`);

      // 1. Load message_job from database
      const messageJob = await this.loadMessageJob(message_job_id);

      if (!messageJob || messageJob.status !== 'pending') {
        console.log(`Message job ${message_job_id} not found or not pending, skipping`);
        // Delete message from queue
        if (receiptHandle) {
          await this.queueClient.deleteMessage(receiptHandle);
        }
        return;
      }

      // 2. TODO: Reserve job (atomic throttle check)
      // For now, we'll skip throttling and proceed
      // const reserved = await this.reserveMessageJob(messageJob);
      // if (!reserved) {
      //   // Throttle limit hit, message will become visible again after visibility timeout
      //   return;
      // }

      // 3. Load related data (lead, mailbox, node config)
      const { lead, mailbox, nodeConfig } = await this.loadJobData(messageJob);

      // 4. Generate email content from template
      const subject = mergeTemplate(nodeConfig.subject || '', lead);
      const emailBody = mergeTemplate(nodeConfig.body || '', lead);

      // 5. Create SMTP transporter
      const transporter = createTransporter(mailbox);

      // 6. Send email
      const providerMessageId = await sendEmail(
        transporter,
        mailbox,
        messageJob,
        lead,
        subject,
        emailBody
      );

      // 7. Update message_job status
      await this.supabase
        .from('message_jobs')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
        })
        .eq('id', message_job_id);

      // 8. Create event record
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
          },
        });

      console.log(`Successfully sent email for message job ${message_job_id}`);

      // 9. Delete message from queue
      if (receiptHandle) {
        await this.queueClient.deleteMessage(receiptHandle);
      }

    } catch (error) {
      console.error('Error processing message:', error);
      // Message will become visible again after visibility timeout
      // TODO: Implement retry logic with exponential backoff
      // TODO: Move to DLQ after max retries
    }
  }

  /**
   * Load message job from database
   */
  private async loadMessageJob(messageJobId: string): Promise<MessageJob | null> {
    const { data, error } = await this.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();

    if (error) {
      console.error('Error loading message job:', error);
      return null;
    }

    return data as MessageJob;
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

