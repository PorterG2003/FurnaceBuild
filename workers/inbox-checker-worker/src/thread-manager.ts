import { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessedMessage, Mailbox, MessageJob } from './types.js';

/**
 * Thread manager for creating email threads and messages
 */
export class ThreadManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Handle a reply message
   */
  async handleReply(
    mailbox: Mailbox,
    message: ProcessedMessage
  ): Promise<boolean> {
    // Extract Message-ID from In-Reply-To (remove < > brackets if present)
    const inReplyToRaw = message.inReplyTo?.trim();
    if (!inReplyToRaw) return false;

    const inReplyToMessageId = inReplyToRaw.replace(/^<|>$/g, '');
    if (!inReplyToMessageId) return false;

    // Find the original message_job by provider_message_id.
    // DB may store with or without angle brackets depending on provider.
    const { data: jobs, error: jobError } = await this.supabase
      .from('message_jobs')
      .select(`
        *,
        enrollments(*),
        campaigns(*),
        leads(*),
        mailboxes(account_id, email_address)
      `)
      .eq('status', 'sent')
      .in('provider_message_id', [inReplyToMessageId, `<${inReplyToMessageId}>`])
      .limit(1);

    const originalJob = Array.isArray(jobs) && jobs.length > 0 ? jobs[0] : null;

    if (jobError || !originalJob) {
      return false; // Not a reply to our message
    }

    // Get or create email thread
    const thread = await this.getOrCreateThread(originalJob, mailbox);

    // Create email_message for the reply
    const { data: emailMessage, error: messageError } = await this.supabase
      .from('email_messages')
      .insert({
        thread_id: thread.id,
        message_job_id: null, // This is a received message
        direction: 'received',
        from_email: message.from.address,
        from_name: message.from.name || null,
        to_email: message.to[0]?.address || mailbox.email_address,
        to_name: message.to[0]?.name || null,
        subject: message.subject,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        message_references: message.references,
        received_at: message.date.toISOString(),
        headers: message.headers as any,
        attachments: message.attachments as any,
      })
      .select()
      .single();

    if (messageError) {
      console.error('Error creating email_message:', messageError);
      throw messageError;
    }

    // Update thread: set has_reply = true, update last_message_at, increment message_count
    await this.supabase
      .from('email_threads')
      .update({
        has_reply: true,
        last_message_at: message.date.toISOString(),
        message_count: thread.message_count + 1,
        participants: Array.from(new Set([
          ...(thread.participants || []),
          message.from.address,
          ...message.to.map(t => t.address),
        ])),
      })
      .eq('id', thread.id);

    // Stop the enrollment
    await this.supabase
      .from('enrollments')
      .update({ state: 'stopped' })
      .eq('id', originalJob.enrollment_id);

    console.log(`Reply detected and processed: message_job ${originalJob.id}, enrollment ${originalJob.enrollment_id} stopped`);
    return true;
  }

  /**
   * Get or create email thread for a message_job
   */
  private async getOrCreateThread(
    messageJob: MessageJob,
    mailbox: Mailbox
  ): Promise<any> {
    // Check if thread already exists
    const { data: existingThread } = await this.supabase
      .from('email_threads')
      .select('*')
      .eq('message_job_id', messageJob.id)
      .maybeSingle();

    if (existingThread) {
      return existingThread;
    }

    // Get message data
    const messageData = messageJob.message_data || {};
    const subject = messageData.subject || messageData.node_config?.subject || '(No Subject)';

    // Get account_id from mailbox (from the relation or directly)
    const accountId = messageJob.mailboxes?.account_id || mailbox.account_id;
    const mailboxEmail = messageJob.mailboxes?.email_address || mailbox.email_address;
    const leadEmail = messageJob.leads?.email || '';

    // Create new thread
    const { data: newThread, error: threadError } = await this.supabase
      .from('email_threads')
      .insert({
        account_id: accountId,
        campaign_id: messageJob.campaign_id,
        lead_id: messageJob.lead_id,
        enrollment_id: messageJob.enrollment_id,
        message_job_id: messageJob.id,
        mailbox_id: messageJob.mailbox_id,
        subject: subject,
        participants: [mailboxEmail, leadEmail].filter(Boolean),
        last_message_at: messageJob.sent_at || messageJob.created_at,
        message_count: 1,
        has_reply: false, // Will be set to true when reply is received
      })
      .select()
      .single();

    if (threadError) {
      console.error('Error creating email_thread:', threadError);
      throw threadError;
    }

    return newThread;
  }

  /**
   * Handle a bounce message
   */
  async handleBounce(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    // Try to find the original message_job by matching recipient email
    // Bounces usually have the original recipient in the body or headers
    const recipientEmail = message.to[0]?.address;
    if (!recipientEmail) return;

    // Find recent sent message_jobs to this recipient from this mailbox
    const { data: recentJobs } = await this.supabase
      .from('message_jobs')
      .select('enrollment_id')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
      .order('sent_at', { ascending: false })
      .limit(50);

    if (!recentJobs || recentJobs.length === 0) return;

    // Stop enrollments (conservative approach - stop all recent enrollments from this mailbox)
    const enrollmentIds = new Set(recentJobs.map(j => j.enrollment_id));
    for (const enrollmentId of enrollmentIds) {
      await this.supabase
        .from('enrollments')
        .update({ state: 'stopped' })
        .eq('id', enrollmentId);
    }

    console.log(`Bounce detected in mailbox ${mailbox.id}, stopped ${enrollmentIds.size} enrollments`);
  }

  /**
   * Handle an unsubscribe message
   */
  async handleUnsubscribe(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    // Similar to bounce - find recent enrollments and stop them
    const recipientEmail = message.to[0]?.address;
    if (!recipientEmail) return;

    // Find recent sent message_jobs to this recipient
    const { data: recentJobs } = await this.supabase
      .from('message_jobs')
      .select('enrollment_id')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
      .order('sent_at', { ascending: false })
      .limit(100);

    if (!recentJobs || recentJobs.length === 0) return;

    // Stop enrollments for this recipient
    const enrollmentIds = new Set(recentJobs.map(j => j.enrollment_id));
    for (const enrollmentId of enrollmentIds) {
      await this.supabase
        .from('enrollments')
        .update({ state: 'stopped' })
        .eq('id', enrollmentId);
    }

    console.log(`Unsubscribe detected in mailbox ${mailbox.id}, stopped ${enrollmentIds.size} enrollments`);
  }
}
