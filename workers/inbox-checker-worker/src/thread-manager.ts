import { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessedMessage, Mailbox, MessageJob } from './types.js';
import {
  extractCandidateEmails,
  classifyBounce,
} from './bounce-detection/index.js';

/**
 * Thread manager for creating email threads and messages
 */
export class ThreadManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Normalize Message-ID for consistent storage and matching
   * - Removes angle brackets (< >)
   * - Converts to lowercase (Message-IDs are case-insensitive per RFC 5322)
   * - Returns null if input is null/empty
   */
  private normalizeMessageId(messageId: string | null | undefined): string | null {
    if (!messageId) return null;
    // Remove brackets and convert to lowercase
    return messageId.trim().replace(/^<|>$/g, '').toLowerCase() || null;
  }

  /**
   * Handle a reply message
   * 
   * Handles two cases:
   * 1. Reply to original sent message (In-Reply-To matches message_job.provider_message_id)
   * 2. Reply to a reply (In-Reply-To matches email_message.message_id)
   */
  async handleReply(
    mailbox: Mailbox,
    message: ProcessedMessage
  ): Promise<boolean> {
    // Normalize the incoming message's Message-ID
    const normalizedMessageId = this.normalizeMessageId(message.messageId);
    if (!normalizedMessageId) {
      console.warn(`[INBOX CHECKER] Message has no Message-ID, skipping reply processing`);
      return false;
    }

    // Extract Message-IDs to search for (from In-Reply-To and References)
    // Some email clients (especially Outlook) use References instead of In-Reply-To
    const messageIdsToSearch: string[] = [];

    // Add In-Reply-To if present
    const inReplyToRaw = message.inReplyTo?.trim();
    if (inReplyToRaw) {
      const normalized = this.normalizeMessageId(inReplyToRaw);
      if (normalized) {
        messageIdsToSearch.push(normalized);
      }
    }

    // Add all Message-IDs from References header (contains full thread history)
    // References format: "msg1@example.com <msg2@example.com> msg3@example.com"
    if (message.references) {
      // Split by whitespace and extract Message-IDs (with or without brackets)
      const refParts = message.references.split(/\s+/);
      for (const part of refParts) {
        const normalized = this.normalizeMessageId(part);
        if (normalized && !messageIdsToSearch.includes(normalized)) {
          messageIdsToSearch.push(normalized);
        }
      }
    }

    if (messageIdsToSearch.length === 0) {
      // No In-Reply-To or References - can't determine if this is a reply
      return false;
    }

    // Check if this message already exists (duplicate check)
    const { data: existingMessage } = await this.supabase
      .from('email_messages')
      .select('id, thread_id')
      .eq('message_id', normalizedMessageId)
      .maybeSingle();

    if (existingMessage) {
      console.log(`[INBOX CHECKER] Message ${normalizedMessageId} already processed, skipping duplicate`);
      return true; // Already processed, return success
    }

    let thread: any;
    let originalJob: MessageJob | null = null;
    let isReplyToOriginal = false;

    // First, try to find if this is a reply to an original sent message
    // Check all Message-IDs from In-Reply-To and References against message_jobs
    // Use case-insensitive matching to handle both normalized and non-normalized values
    let foundJob: MessageJob | null = null;
    for (const searchId of messageIdsToSearch) {
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
        .or(`provider_message_id.ilike.%${searchId}%,provider_message_id.ilike.%<${searchId}>%`)
        .limit(1);

      if (!jobError && jobs && jobs.length > 0 && jobs[0]) {
        foundJob = jobs[0];
        break; // Found a match, stop searching
      }
    }

    if (foundJob) {
      originalJob = foundJob;
      isReplyToOriginal = true;
      // Inbox reply/forward jobs don't own a thread — they belong to an existing thread (message_data.thread_id)
      const md = (foundJob as any).message_data || {};
      const isInboxReplyOrForward =
        (foundJob as any).message_type === 'inbox_reply' ||
        (foundJob as any).message_type === 'inbox_forward' ||
        md.source === 'inbox_reply' ||
        md.source === 'inbox_forward';
      const existingThreadId = md.thread_id;

      if (isInboxReplyOrForward && existingThreadId) {
        const { data: existingThread, error: threadError } = await this.supabase
          .from('email_threads')
          .select('*')
          .eq('id', existingThreadId)
          .single();
        if (threadError || !existingThread) {
          console.error('[INBOX CHECKER] Inbox reply job references missing thread:', existingThreadId, threadError);
          return false;
        }
        thread = existingThread;
      } else {
        // Campaign send: get or create thread by message_job_id
        thread = await this.getOrCreateThread(originalJob as MessageJob, mailbox);
      }
    } else {
      // Not a reply to original sent message - check if it's a reply to a received message
      // Check all Message-IDs from In-Reply-To and References against email_messages
      // Since we normalize when storing, we can use eq() for exact match
      let parentMessage: any = null;
      for (const searchId of messageIdsToSearch) {
        const { data: messages, error: messageError } = await this.supabase
          .from('email_messages')
          .select(`
            id,
            thread_id,
            message_id
          `)
          .eq('message_id', searchId)
          .limit(1);

        if (!messageError && messages && messages.length > 0 && messages[0]?.thread_id) {
          parentMessage = messages[0];
          break; // Found a match, stop searching
        }
      }

      if (!parentMessage || !parentMessage.thread_id) {
        // Checked all Message-IDs from In-Reply-To and References, no match found
        return false; // Not a reply to any message we know about
      }

      // Found a parent message - get its thread
      const { data: existingThread, error: threadError } = await this.supabase
        .from('email_threads')
        .select('*')
        .eq('id', parentMessage.thread_id)
        .single();

      if (threadError || !existingThread) {
        console.error('Error loading thread for reply-to-reply:', threadError);
        return false;
      }

      thread = existingThread;
    }

    // Create email_message for the reply
    // Store normalized message_id for consistent matching
    // Store imap_uid for on-demand attachment fetching
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
        message_id: normalizedMessageId, // Store normalized version
        in_reply_to: this.normalizeMessageId(message.inReplyTo),
        message_references: message.references ? this.normalizeMessageId(message.references) : null,
        received_at: message.date.toISOString(),
        headers: message.headers as any,
        attachments: message.attachments as any, // Includes part and imapUid for on-demand fetching
        imap_uid: message.uid, // Store IMAP UID for on-demand attachment fetching
      })
      .select()
      .single();

    if (messageError) {
      // Check if it's a duplicate error (unique constraint violation)
      if (messageError.code === '23505' || messageError.message?.includes('duplicate')) {
        console.log(`[INBOX CHECKER] Message ${normalizedMessageId} already exists (race condition), skipping`);
        return true; // Already processed by another worker, return success
      }
      console.error('Error creating email_message:', messageError);
      throw messageError;
    }

    // Update thread: set has_reply = true, update last_message_at
    // Recalculate message_count from actual count to avoid race conditions
    const { count: actualMessageCount, error: countError } = await this.supabase
      .from('email_messages')
      .select('*', { count: 'exact', head: true })
      .eq('thread_id', thread.id);

    if (countError) {
      console.error('Error counting messages for thread:', countError);
      // Fall back to incrementing if count fails
      const fallbackCount = (thread.message_count || 0) + 1;
      await this.supabase
        .from('email_threads')
        .update({
          has_reply: true,
          last_message_at: message.date.toISOString(),
          message_count: fallbackCount,
          participants: Array.from(new Set([
            ...(thread.participants || []),
            message.from.address,
            ...message.to.map(t => t.address),
          ])),
        })
        .eq('id', thread.id);
    } else {
      await this.supabase
        .from('email_threads')
        .update({
          has_reply: true,
          last_message_at: message.date.toISOString(),
          message_count: actualMessageCount || 1, // Use actual count to avoid race conditions
          participants: Array.from(new Set([
            ...(thread.participants || []),
            message.from.address,
            ...message.to.map(t => t.address),
          ])),
        })
        .eq('id', thread.id);
    }

    // Only stop the enrollment if this is a reply to the original sent message
    // (not a reply to a reply)
    if (isReplyToOriginal && originalJob) {
      await this.supabase
        .from('enrollments')
        .update({ state: 'stopped' })
        .eq('id', originalJob.enrollment_id);

      const isCampaignReply =
        (originalJob as any).message_type !== 'inbox_reply' &&
        (originalJob as any).message_type !== 'inbox_forward' &&
        (originalJob as any).message_data?.source !== 'inbox_reply' &&
        (originalJob as any).message_data?.source !== 'inbox_forward';

      if (isCampaignReply) {
        await this.supabase.from('events').insert({
          campaign_id: originalJob.campaign_id,
          lead_id: originalJob.lead_id,
          enrollment_id: originalJob.enrollment_id,
          message_job_id: originalJob.id,
          event_type: 'replied',
          event_data: { detected_at: new Date().toISOString() },
        });
        const isPositive = (thread as any).category === 'Interested';
        const { error: statsError } = await this.supabase.rpc('increment_campaign_stats_replied', {
          p_campaign_id: originalJob.campaign_id,
          p_is_positive: isPositive,
        });
        if (statsError) {
          console.error(`[INBOX CHECKER] Failed to increment campaign_stats replied for campaign ${originalJob.campaign_id}:`, statsError);
        }
      }

      console.log(`Reply to original message detected and processed: message_job ${originalJob.id}, enrollment ${originalJob.enrollment_id} stopped`);
    } else {
      console.log(`Reply to reply detected and processed: added to thread ${thread.id}`);
    }

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

    // Backfill the original sent message into email_messages
    // Check if it already exists (shouldn't, but check to avoid duplicates)
    const { data: existingSentMessage } = await this.supabase
      .from('email_messages')
      .select('id')
      .eq('message_job_id', messageJob.id)
      .eq('direction', 'sent')
      .maybeSingle();

    if (!existingSentMessage) {
      // Extract body from message_data (template - not merged, but that's okay for now)
      // Builder saves body as "template"; support both for display
      const body = messageData.node_config?.body ?? messageData.node_config?.template ?? '';
      const leadName = messageJob.leads?.name || null;
      const mailboxDisplayName = mailbox.display_name || null;

      // Normalize provider_message_id for consistent storage
      const normalizedProviderMessageId = this.normalizeMessageId(messageJob.provider_message_id);
      
      // Create email_message for the original sent message
      const { error: sentMessageError } = await this.supabase
        .from('email_messages')
        .insert({
          thread_id: newThread.id,
          message_job_id: messageJob.id,
          direction: 'sent',
          from_email: mailboxEmail,
          from_name: mailboxDisplayName,
          to_email: leadEmail,
          to_name: leadName,
          subject: subject,
          body_text: body, // Template body (not merged, but sufficient for display)
          body_html: body, // Same for now (send worker uses same body for text/html)
          message_id: normalizedProviderMessageId, // Store normalized version
          in_reply_to: null, // Original message has no In-Reply-To
          message_references: null,
          received_at: messageJob.sent_at || messageJob.created_at,
          headers: {}, // We don't store headers for sent messages
          attachments: [],
        });

      if (sentMessageError) {
        console.error('Error creating email_message for original sent message:', sentMessageError);
        throw new Error(`Failed to backfill original sent message for thread: ${sentMessageError.message}`);
      }
      // Note: message_count is already set to 1 (original sent message)
      // handleReply will increment it when the reply is added
    }

    return newThread;
  }

  /**
   * Handle a bounce message: idempotency check, match to message_jobs, write events (with severity/code),
   * update campaign_stats, narrow fallback (stop only best-guess when no match), lead suppression on hard bounce.
   */
  async handleBounce(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    if (message.messageId) {
      const { data: existingByMsgId } = await this.supabase
        .from('events')
        .select('id')
        .eq('event_type', 'bounced')
        .eq('mailbox_id', mailbox.id)
        .filter('event_data', 'cs', { bounce_message_id: message.messageId })
        .limit(1)
        .maybeSingle();
      if (existingByMsgId?.id) {
        console.log(`[INBOX CHECKER] Bounce already processed (idempotency), skipping messageId: ${message.messageId}`);
        return;
      }
    } else if (message.uid != null) {
      const { data: existingByUid } = await this.supabase
        .from('events')
        .select('id')
        .eq('event_type', 'bounced')
        .eq('mailbox_id', mailbox.id)
        .filter('event_data', 'cs', { bounce_uid: message.uid })
        .limit(1)
        .maybeSingle();
      if (existingByUid?.id) {
        console.log(`[INBOX CHECKER] Bounce already processed (idempotency), skipping uid: ${message.uid}`);
        return;
      }
    }

    const candidateEmails = extractCandidateEmails({
      subject: message.subject,
      from: message.from,
      to: message.to,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      headers: message.headers,
      messageId: message.messageId,
      uid: message.uid,
    });
    if (candidateEmails.length === 0) return;

    const classification = classifyBounce({ bodyText: message.bodyText, bodyHtml: message.bodyHtml });
    const eventDataBase = {
      detected_at: new Date().toISOString(),
      severity: classification.severity,
      ...(classification.smtpCode && { smtp_code: classification.smtpCode }),
      ...(message.messageId && { bounce_message_id: message.messageId }),
      ...(message.uid != null && { bounce_uid: message.uid }),
    };

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: jobsWithLeads } = await this.supabase
      .from('message_jobs')
      .select('id, campaign_id, enrollment_id, lead_id, sent_at')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(100);

    if (!jobsWithLeads || jobsWithLeads.length === 0) return;

    const { data: account } = await this.supabase
      .from('accounts')
      .select('suppress_bounced_emails')
      .eq('id', mailbox.account_id)
      .single();
    const suppressBouncedEmails = account?.suppress_bounced_emails !== false;

    const leadIds = [...new Set(jobsWithLeads.map((j) => j.lead_id))];
    const { data: leads } = await this.supabase
      .from('leads')
      .select('id, email')
      .in('id', leadIds);
    const leadEmailById = new Map((leads || []).map((l) => [l.id, (l.email || '').toLowerCase()]));

    const candidateSet = new Set(candidateEmails);
    const matchedJobs = jobsWithLeads.filter((j) => candidateSet.has(leadEmailById.get(j.lead_id) || ''));

    const campaignIdsUpdated = new Set<string>();
    const enrollmentsToStop: string[] = [];

    if (matchedJobs.length > 0) {
      enrollmentsToStop.push(...matchedJobs.map((j) => j.enrollment_id));
      for (const job of matchedJobs) {
        await this.supabase.from('events').insert({
          campaign_id: job.campaign_id,
          lead_id: job.lead_id,
          enrollment_id: job.enrollment_id,
          message_job_id: job.id,
          mailbox_id: mailbox.id,
          event_type: 'bounced',
          event_data: eventDataBase,
        });
        if (!campaignIdsUpdated.has(job.campaign_id)) {
          campaignIdsUpdated.add(job.campaign_id);
          const { error } = await this.supabase.rpc('increment_campaign_stats_bounce', {
            p_campaign_id: job.campaign_id,
          });
          if (error) {
            console.error(`[INBOX CHECKER] Failed to increment campaign_stats bounce for campaign ${job.campaign_id}:`, error);
          }
        }
        if (classification.severity === 'hard' && suppressBouncedEmails) {
          const leadEmail = leadEmailById.get(job.lead_id);
          if (leadEmail) {
            await this.supabase.from('block_list').upsert(
              { account_id: mailbox.account_id, value: leadEmail, type: 'email', reason: 'bounced' },
              { onConflict: 'account_id,value,type', ignoreDuplicates: true }
            );
          }
        }
      }
    } else {
      const bestGuess = jobsWithLeads[0];
      if (bestGuess) {
        enrollmentsToStop.push(bestGuess.enrollment_id);
        await this.supabase.from('events').insert({
          campaign_id: bestGuess.campaign_id,
          lead_id: bestGuess.lead_id,
          enrollment_id: bestGuess.enrollment_id,
          message_job_id: bestGuess.id,
          mailbox_id: mailbox.id,
          event_type: 'bounced',
          event_data: { ...eventDataBase, matched: false },
        });
        const { error } = await this.supabase.rpc('increment_campaign_stats_bounce', {
          p_campaign_id: bestGuess.campaign_id,
        });
        if (error) {
          console.error(`[INBOX CHECKER] Failed to increment campaign_stats bounce for campaign ${bestGuess.campaign_id}:`, error);
        }
        if (classification.severity === 'hard' && suppressBouncedEmails) {
          const leadEmail = leadEmailById.get(bestGuess.lead_id);
          if (leadEmail) {
            await this.supabase.from('block_list').upsert(
              { account_id: mailbox.account_id, value: leadEmail, type: 'email', reason: 'bounced' },
              { onConflict: 'account_id,value,type', ignoreDuplicates: true }
            );
          }
        }
      }
    }

    for (const enrollmentId of enrollmentsToStop) {
      await this.supabase.from('enrollments').update({ state: 'stopped' }).eq('id', enrollmentId);
    }

    console.log(`Bounce detected in mailbox ${mailbox.id}, stopped ${enrollmentsToStop.length} enrollments, severity=${classification.severity}`);
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
