import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { SupabaseClient } from '@supabase/supabase-js';
import type { ProcessedMessage, Mailbox, MessageJob } from './types.js';
import {
  extractCandidateEmails,
  classifyBounce,
} from './bounce-detection/index.js';
import { isAutoReplyMessage } from './message-processor.js';
import { emitEmailReceivedNotification } from './emit-notification-event.js';
import { emitWebhookEvent } from './emit-webhook-event.js';

type EmailThreadRow = {
  id: string;
  account_id: string;
  mailbox_id: string | null;
  created_at: string;
  last_message_at: string | null;
  message_count?: number | null;
  participants?: string[] | null;
  category?: string | null;
};

type ParentMessageCandidate = {
  id: string;
  thread_id: string;
  message_id: string | null;
  received_at: string;
  created_at: string;
  email_threads: EmailThreadRow | EmailThreadRow[] | null;
};

/** Clears thread OOO when a new received message arrives; matches mark_email_thread_out_of_office clear branch. */
const OOO_CLEAR_FOR_NEW_INBOUND_REPLY = {
  out_of_office: false,
  ooo_resume_requested: false,
  ooo_resume_at: null,
  ooo_resume_processed_at: null,
} as const;

const CATEGORIZER_CACHE_TTL_MS = 60 * 1000;

/**
 * Thread manager for creating email threads and messages
 */
export class ThreadManager {
  /** Per-campaign "flow has a categorizer node" cache (TTL = one worker tick). */
  private categorizerCache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(private supabase: SupabaseClient) {}

  /**
   * Whether the campaign's flow contains a live categorizer node.
   * Cached per campaign for roughly one worker tick.
   */
  private async campaignHasCategorizer(campaignId: string): Promise<boolean> {
    const cached = this.categorizerCache.get(campaignId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const { data, error } = await this.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('node_type', 'aiCategorizer')
      .is('deleted_at', null)
      .limit(1);

    if (error) {
      // Fail open to the legacy stop path; do not cache errors.
      console.error(`[INBOX CHECKER] Failed to check categorizer for campaign ${campaignId}:`, error);
      return false;
    }

    const value = (data?.length ?? 0) > 0;
    this.categorizerCache.set(campaignId, { value, expiresAt: Date.now() + CATEGORIZER_CACHE_TTL_MS });
    return value;
  }

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

  private normalizeEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    return email.trim().toLowerCase() || null;
  }

  private unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  private parseTimestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
    return error?.code === '23505' || error?.message?.includes('duplicate') === true;
  }

  private rankReplyJobCandidate(job: MessageJob, mailbox: Mailbox): number {
    if (job.mailbox_id === mailbox.id) return 0;

    const relatedMailbox = this.unwrapRelation(job.mailboxes);
    if (
      relatedMailbox?.account_id === mailbox.account_id &&
      this.normalizeEmail(relatedMailbox.email_address) === this.normalizeEmail(mailbox.email_address)
    ) {
      return 1;
    }

    return 2;
  }

  private selectReplyJobCandidate(
    jobs: MessageJob[],
    mailbox: Mailbox,
    searchId: string
  ): MessageJob | null {
    const exactMatches = jobs.filter((job) => this.normalizeMessageId(job.provider_message_id) === searchId);
    if (exactMatches.length === 0) return null;

    return exactMatches.sort((a, b) => {
      const rankDiff = this.rankReplyJobCandidate(a, mailbox) - this.rankReplyJobCandidate(b, mailbox);
      if (rankDiff !== 0) return rankDiff;

      const timeDiff =
        this.parseTimestamp(b.sent_at || b.created_at) -
        this.parseTimestamp(a.sent_at || a.created_at);
      if (timeDiff !== 0) return timeDiff;

      return a.id.localeCompare(b.id);
    })[0] ?? null;
  }

  private rankBounceJobCandidate(job: MessageJob): number {
    const messageType = job.message_type ?? null;

    if (messageType === null || messageType === 'campaign') {
      return 0;
    }

    if (messageType === 'campaign_reply') {
      return 1;
    }

    if (messageType === 'inbox_reply' || messageType === 'inbox_forward') {
      return 2;
    }

    return 1;
  }

  private selectBounceJobCandidate(jobs: MessageJob[]): MessageJob | null {
    if (jobs.length === 0) return null;

    return jobs.sort((a, b) => {
      const rankDiff = this.rankBounceJobCandidate(a) - this.rankBounceJobCandidate(b);
      if (rankDiff !== 0) return rankDiff;

      const timeDiff =
        this.parseTimestamp(b.sent_at || b.created_at) -
        this.parseTimestamp(a.sent_at || a.created_at);
      if (timeDiff !== 0) return timeDiff;

      return a.id.localeCompare(b.id);
    })[0] ?? null;
  }

  private rankParentMessageCandidate(candidate: ParentMessageCandidate, mailbox: Mailbox): number {
    const thread = this.unwrapRelation(candidate.email_threads);
    if (!thread) return Number.MAX_SAFE_INTEGER;
    if (thread.mailbox_id === mailbox.id) return 0;
    if (!thread.mailbox_id) return 1;
    return 2;
  }

  private selectParentMessageCandidate(
    candidates: ParentMessageCandidate[],
    mailbox: Mailbox
  ): ParentMessageCandidate | null {
    const scopedCandidates = candidates.filter((candidate) => {
      const thread = this.unwrapRelation(candidate.email_threads);
      return thread?.account_id === mailbox.account_id;
    });

    if (scopedCandidates.length === 0) return null;

    return scopedCandidates.sort((a, b) => {
      const rankDiff = this.rankParentMessageCandidate(a, mailbox) - this.rankParentMessageCandidate(b, mailbox);
      if (rankDiff !== 0) return rankDiff;

      const aThread = this.unwrapRelation(a.email_threads);
      const bThread = this.unwrapRelation(b.email_threads);
      const threadTimeDiff =
        this.parseTimestamp(aThread?.created_at) - this.parseTimestamp(bThread?.created_at);
      if (threadTimeDiff !== 0) return threadTimeDiff;

      const messageTimeDiff = this.parseTimestamp(a.received_at) - this.parseTimestamp(b.received_at);
      if (messageTimeDiff !== 0) return messageTimeDiff;

      return a.id.localeCompare(b.id);
    })[0] ?? null;
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
    message: ProcessedMessage,
    options?: { isUnsubscribe?: boolean }
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
    const { data: existingMessages } = await this.supabase
      .from('email_messages')
      .select('id, thread_id')
      .eq('account_id', mailbox.account_id)
      .eq('message_id', normalizedMessageId)
      .order('created_at', { ascending: true })
      .limit(1);

    const existingMessage = existingMessages?.[0];

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
        .eq('account_id', mailbox.account_id)
        .eq('status', 'sent')
        .or(`provider_message_id.ilike.%${searchId}%,provider_message_id.ilike.%<${searchId}>%`)
        .limit(10);

      if (!jobError && jobs && jobs.length > 0) {
        foundJob = this.selectReplyJobCandidate(jobs as MessageJob[], mailbox, searchId);
      }

      if (foundJob) {
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
          .eq('account_id', mailbox.account_id)
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
      let parentMessage: ParentMessageCandidate | null = null;
      for (const searchId of messageIdsToSearch) {
        const { data: messages, error: messageError } = await this.supabase
          .from('email_messages')
          .select(`
            id,
            thread_id,
            message_id,
            received_at,
            created_at,
            email_threads!inner(
              id,
              account_id,
              mailbox_id,
              created_at,
              last_message_at
            )
          `)
          .eq('account_id', mailbox.account_id)
          .eq('message_id', searchId)
          .order('created_at', { ascending: true })
          .limit(10);

        if (!messageError && messages && messages.length > 0) {
          parentMessage = this.selectParentMessageCandidate(
            messages as ParentMessageCandidate[],
            mailbox
          );
        }

        if (parentMessage?.thread_id) {
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
        account_id: thread.account_id,
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
      reportErrorToSlack('Inbox-checker: failed to create email_message', {
        severity: 'critical',
        thread_id: thread.id,
        error: messageError.message,
        alertPolicy: isRetryableSupabaseReadError(messageError.message)
          ? 'transient_retryable_warning'
          : 'critical_failure',
        aggregationKey: isRetryableSupabaseReadError(messageError.message)
          ? `inbox-create-email-message:${thread.id}`
          : undefined,
        summaryFields: {
          thread_id: thread.id,
        },
      });
      throw messageError;
    }

    // Auto Reply category handling:
    // - header-detected autoresponder stamps the thread Auto Reply (never
    //   overwriting a user-set category)
    // - a real inbound reply clears a machine-set Auto Reply so the new
    //   message gets classified
    const inboundIsAutoReply = isAutoReplyMessage(message.headers);
    const threadCategory: string | null = (thread as any).category ?? null;
    const threadCategorySource: string | null = (thread as any).category_source ?? null;
    let threadCategoryPatch: Record<string, unknown> = {};
    if (inboundIsAutoReply) {
      if (threadCategorySource !== 'user') {
        threadCategoryPatch = { category: 'Auto Reply', category_source: 'system' };
      }
    } else if (
      threadCategory === 'Auto Reply' &&
      (threadCategorySource === 'system' || threadCategorySource === 'ai')
    ) {
      threadCategoryPatch = { category: null, category_source: null };
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
          ...OOO_CLEAR_FOR_NEW_INBOUND_REPLY,
          ...threadCategoryPatch,
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
          ...OOO_CLEAR_FOR_NEW_INBOUND_REPLY,
          ...threadCategoryPatch,
        })
        .eq('id', thread.id);
    }

    // Only act on the enrollment if this is a reply to the original sent message
    // (not a reply to a reply)
    if (isReplyToOriginal && originalJob) {
      const isCampaignReply =
        (originalJob as any).message_type !== 'inbox_reply' &&
        (originalJob as any).message_type !== 'inbox_forward' &&
        (originalJob as any).message_data?.source !== 'inbox_reply' &&
        (originalJob as any).message_data?.source !== 'inbox_forward';

      // Categorizer flows: hold the outbound sequence and fast-forward to the
      // categorizer instead of stopping. Unsubscribe replies keep the legacy
      // hard stop. Any failure falls back to the legacy stop (safe: halts
      // outbound for someone who replied).
      let parkStatus: string | null = null;
      const categorizerFlow =
        isCampaignReply &&
        !!originalJob.enrollment_id &&
        (await this.campaignHasCategorizer(originalJob.campaign_id));
      if (categorizerFlow && !options?.isUnsubscribe) {
        const { data: parkResult, error: parkError } = await this.supabase.rpc(
          'park_or_advance_enrollment_on_reply',
          {
            p_enrollment_id: originalJob.enrollment_id,
            p_thread_id: thread.id,
          }
        );

        if (parkError) {
          console.error(
            `[INBOX CHECKER] park_or_advance_enrollment_on_reply failed for enrollment ${originalJob.enrollment_id}:`,
            parkError
          );
          reportErrorToSlack('Inbox-checker: park_or_advance_enrollment_on_reply failed', {
            severity: 'critical',
            campaign_id: originalJob.campaign_id,
            enrollment_id: originalJob.enrollment_id,
            thread_id: thread.id,
            error: parkError.message,
            alertPolicy: 'critical_failure',
            aggregationKey: `categorizer-park:${originalJob.campaign_id}`,
            summaryFields: {
              campaign_id: originalJob.campaign_id,
            },
          });
        } else {
          parkStatus = (parkResult as string | null) ?? null;
        }
      }

      if (parkStatus === 'held' || parkStatus === 'woken' || parkStatus === 'branched') {
        console.log(
          `[INBOX CHECKER] Reply routed to categorizer (${parkStatus}) for enrollment ${originalJob.enrollment_id}`
        );
      } else {
        const stoppedAt = new Date().toISOString();
        await this.supabase
          .from('enrollments')
          .update({ state: 'stopped', stopped_reason: 'replied', stopped_at: stoppedAt })
          .eq('id', originalJob.enrollment_id)
          .is('deleted_at', null);

        // Held-job hygiene for categorizer flows that hard-stopped anyway
        // (unsubscribe reply or park RPC failure with a prior hold in place).
        if (categorizerFlow) {
          const { error: heldCancelError } = await this.supabase.rpc('cancel_held_jobs_for_enrollment', {
            p_enrollment_id: originalJob.enrollment_id,
          });
          if (heldCancelError) {
            console.error(
              `[INBOX CHECKER] Failed to cancel held jobs for stopped enrollment ${originalJob.enrollment_id}:`,
              heldCancelError
            );
          }
        }
      }

      if (isCampaignReply) {
        const isPositive = (thread as any).category === 'Interested';
        const eventData = { detected_at: new Date().toISOString() };
        const { data: inserted, error } = await this.supabase.rpc('record_replied_event_and_increment', {
          p_campaign_id: originalJob.campaign_id,
          p_lead_id: originalJob.lead_id,
          p_enrollment_id: originalJob.enrollment_id,
          p_message_job_id: originalJob.id,
          p_event_data: eventData,
          p_is_positive: isPositive,
        });
        if (error) {
          console.error(`[INBOX CHECKER] Failed to record replied event and increment campaign_stats for campaign ${originalJob.campaign_id}:`, error);
          reportErrorToSlack('Inbox-checker: record_replied_event_and_increment failed', {
            severity: 'warning',
            campaign_id: originalJob.campaign_id,
            message_job_id: originalJob.id,
            error: error.message,
            alertPolicy: isRetryableSupabaseReadError(error.message)
              ? 'transient_retryable_warning'
              : 'persistent_config_warning',
            aggregationKey: `inbox-record-replied:${originalJob.campaign_id}`,
            summaryFields: {
              campaign_id: originalJob.campaign_id,
            },
          });
        } else if (!inserted) {
          console.log(`[INBOX CHECKER] Reply already processed for message_job ${originalJob.id}, skipping event and stats`);
        }
      }

      console.log(
        `Reply to original message detected and processed: message_job ${originalJob.id}, enrollment ${originalJob.enrollment_id} ${parkStatus ? `routed to categorizer (${parkStatus})` : 'stopped'}`
      );
    } else {
      console.log(`Reply to reply detected and processed: added to thread ${thread.id}`);
    }

    await emitEmailReceivedNotification(this.supabase, {
      accountId: thread.account_id,
      threadId: thread.id,
      emailMessageId: emailMessage.id,
      mailboxId: mailbox.id,
      fromEmail: message.from.address,
      fromName: message.from.name || null,
      subject: message.subject,
      receivedAt: emailMessage.received_at,
    });

    if (isReplyToOriginal && originalJob) {
      await emitWebhookEvent(this.supabase, {
        accountId: thread.account_id,
        campaignId: originalJob.campaign_id,
        eventType: 'reply.received',
        payload: {
          thread_id: thread.id,
          email_message_id: emailMessage.id,
          campaign_id: originalJob.campaign_id,
          lead_id: originalJob.lead_id,
          enrollment_id: originalJob.enrollment_id,
          mailbox_id: mailbox.id,
          from_email: message.from.address,
          subject: message.subject,
          received_at: emailMessage.received_at,
        },
        dedupeKey: `reply.received:${emailMessage.id}`,
      });
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
    const accountId = messageJob.mailboxes?.account_id || mailbox.account_id;

    // Check if thread already exists for this message_job
    const { data: existingThreads } = await this.supabase
      .from('email_threads')
      .select('*')
      .eq('account_id', accountId)
      .eq('message_job_id', messageJob.id)
      .order('created_at', { ascending: true })
      .limit(1);

    const existingThread = existingThreads?.[0];

    if (existingThread) {
      return existingThread;
    }

    // Check if a thread already exists for this campaign+lead (handles edge case where
    // a later campaign send arrives after the first reply already created a thread)
    const { data: existingCampaignThreads } = await this.supabase
      .from('email_threads')
      .select('*')
      .eq('account_id', accountId)
      .eq('campaign_id', messageJob.campaign_id)
      .eq('lead_id', messageJob.lead_id)
      .order('created_at', { ascending: true })
      .limit(1);

    const existingCampaignThread = existingCampaignThreads?.[0];

    if (existingCampaignThread) {
      await this.backfillSentMessages(
        existingCampaignThread,
        messageJob.campaign_id,
        messageJob.lead_id,
        messageJob.sent_at || messageJob.created_at,
        mailbox
      );
      return existingCampaignThread;
    }

    // Get message data for the thread subject (use first send's merged subject from events if available)
    const messageData = messageJob.message_data || {};
    const templateSubject = messageData.subject || messageData.node_config?.subject || '(No Subject)';

    const mailboxEmail = messageJob.mailboxes?.email_address || mailbox.email_address;
    const leadEmail = messageJob.leads?.email || '';

    // Try to get the merged subject from the sent event for the first send
    const { data: firstSentEvent } = await this.supabase
      .from('events')
      .select('event_data')
      .eq('campaign_id', messageJob.campaign_id)
      .eq('lead_id', messageJob.lead_id)
      .eq('event_type', 'sent')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const subject = firstSentEvent?.event_data?.sent_subject || templateSubject;

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
        has_reply: false,
      })
      .select()
      .single();

    if (threadError) {
      if (this.isUniqueViolation(threadError)) {
        const { data: racedThreads, error: reloadError } = await this.supabase
          .from('email_threads')
          .select('*')
          .eq('account_id', accountId)
          .eq('message_job_id', messageJob.id)
          .order('created_at', { ascending: true })
          .limit(1);

        const racedThread = racedThreads?.[0];
        if (!reloadError && racedThread) {
          return racedThread;
        }
      }

      console.error('Error creating email_thread:', threadError);
      reportErrorToSlack('Inbox-checker: failed to create email_thread', {
        severity: 'critical',
        message_job_id: messageJob.id,
        error: threadError.message,
        alertPolicy: isRetryableSupabaseReadError(threadError.message)
          ? 'transient_retryable_warning'
          : 'critical_failure',
        aggregationKey: isRetryableSupabaseReadError(threadError.message)
          ? `inbox-create-email-thread:${messageJob.id}`
          : undefined,
        summaryFields: {
          message_job_id: messageJob.id,
        },
      });
      throw threadError;
    }

    // Backfill all prior sent messages for this campaign+lead into email_messages
    await this.backfillSentMessages(
      newThread,
      messageJob.campaign_id,
      messageJob.lead_id,
      messageJob.sent_at || messageJob.created_at,
      mailbox
    );

    return newThread;
  }

  /**
   * Backfill sent campaign messages into email_messages for a thread.
   * Queries all sent message_jobs for campaign+lead up to cutoffTime, loads merged
   * content from the sent event's event_data when available, and inserts any missing
   * email_messages (direction = 'sent').
   */
  private async backfillSentMessages(
    thread: any,
    campaignId: string,
    leadId: string,
    cutoffTime: string,
    mailbox: Mailbox
  ): Promise<void> {
    // Get all sent campaign message_jobs for this campaign+lead, ordered by sent_at
    const { data: sentJobs, error: jobsError } = await this.supabase
      .from('message_jobs')
      .select('id, provider_message_id, sent_at, created_at, message_data, mailbox_id, lead_id')
      .eq('campaign_id', campaignId)
      .eq('lead_id', leadId)
      .eq('status', 'sent')
      .or('message_type.is.null,message_type.eq.campaign')
      .lte('sent_at', cutoffTime)
      .order('sent_at', { ascending: true });

    if (jobsError || !sentJobs || sentJobs.length === 0) {
      return;
    }

    const accountId = thread.account_id || mailbox.account_id;

    // Get all sent events for these jobs in one query (for merged content)
    const jobIds = sentJobs.map(j => j.id);
    const { data: sentEvents } = await this.supabase
      .from('events')
      .select('message_job_id, event_data')
      .eq('event_type', 'sent')
      .in('message_job_id', jobIds);

    const eventByJobId = new Map<string, any>();
    if (sentEvents) {
      for (const evt of sentEvents) {
        eventByJobId.set(evt.message_job_id, evt.event_data);
      }
    }

    // Check which jobs already have an email_message
    const { data: existingMessages } = await this.supabase
      .from('email_messages')
      .select('message_job_id')
      .eq('account_id', accountId)
      .eq('thread_id', thread.id)
      .eq('direction', 'sent')
      .in('message_job_id', jobIds);

    const existingJobIds = new Set((existingMessages || []).map(m => m.message_job_id));

    const mailboxEmail = mailbox.email_address;
    const mailboxDisplayName = mailbox.display_name || null;

    // Load lead name once
    const { data: leadRow } = await this.supabase
      .from('leads')
      .select('email, name')
      .eq('id', leadId)
      .maybeSingle();

    const leadEmail = leadRow?.email || '';
    const leadName = leadRow?.name || null;

    let insertedCount = 0;
    for (const job of sentJobs) {
      if (existingJobIds.has(job.id)) continue;

      const evtData = eventByJobId.get(job.id);
      const md = job.message_data || {};
      const nc = md.node_config || {};

      // Use merged content from event when available, else fall back to template
      const jobSubject = evtData?.sent_subject || md.subject || nc.subject || '(No Subject)';
      const jobBodyHtml = evtData?.sent_body_html || nc.body || nc.template || '';
      const jobBodyText = evtData?.sent_body_text || nc.body || nc.template || '';

      const normalizedProviderId = this.normalizeMessageId(job.provider_message_id);

      // Determine in_reply_to / references for follow-ups (not the first send)
      let inReplyTo: string | null = null;
      let msgReferences: string | null = null;
      if (insertedCount > 0 && sentJobs[0]?.provider_message_id) {
        const firstNormalized = this.normalizeMessageId(sentJobs[0].provider_message_id);
        inReplyTo = firstNormalized;
        msgReferences = firstNormalized;
      }

      const { error: insertError } = await this.supabase
        .from('email_messages')
        .insert({
          thread_id: thread.id,
          account_id: thread.account_id,
          message_job_id: job.id,
          direction: 'sent',
          from_email: mailboxEmail,
          from_name: mailboxDisplayName,
          to_email: leadEmail,
          to_name: leadName,
          subject: jobSubject,
          body_text: jobBodyText,
          body_html: jobBodyHtml,
          message_id: normalizedProviderId,
          in_reply_to: inReplyTo,
          message_references: msgReferences,
          received_at: job.sent_at || job.created_at,
          headers: {},
          attachments: [],
        });

      if (insertError) {
        if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
          continue; // Race condition, skip
        }
        console.error(`Error backfilling sent message for job ${job.id}:`, insertError);
        const errorMessage = formatUnknownError(insertError);
        reportErrorToSlack('Inbox-checker: backfill sent message failed', {
          severity: 'warning',
          message_job_id: job.id,
          thread_id: thread.id,
          error: errorMessage,
          alertPolicy: isRetryableSupabaseReadError(errorMessage)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `inbox-backfill-sent-message:${thread.id}`,
          summaryFields: {
            thread_id: thread.id,
          },
        });
      } else {
        insertedCount++;
      }
    }

    // Update thread message_count to reflect backfilled messages
    if (insertedCount > 0) {
      const { count: totalCount } = await this.supabase
        .from('email_messages')
        .select('*', { count: 'exact', head: true })
        .eq('thread_id', thread.id);

      if (totalCount != null) {
        await this.supabase
          .from('email_threads')
          .update({ message_count: totalCount })
          .eq('id', thread.id);
      }
    }
  }

  /**
   * Handle a bounce message: idempotency check, match to message_jobs, write events (with severity/code),
   * update campaign_stats, stop matched enrollments, lead suppression on hard bounce.
   * Unmatched bounces (e.g. warmup or mail sent outside Furnace) are logged only — no stats or enrollment changes.
   */
  async handleBounce(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    const normalizedBounceMessageId = this.normalizeMessageId(message.messageId);

    if (normalizedBounceMessageId) {
      const { data: existingByMsgId } = await this.supabase
        .from('events')
        .select('id')
        .eq('event_type', 'bounced')
        .eq('mailbox_id', mailbox.id)
        .filter('event_data', 'cs', { bounce_message_id: normalizedBounceMessageId })
        .limit(1)
        .maybeSingle();
      if (existingByMsgId?.id) {
        console.log(`[INBOX CHECKER] Bounce already processed (idempotency), skipping messageId: ${normalizedBounceMessageId}`);
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
      ...(normalizedBounceMessageId && { bounce_message_id: normalizedBounceMessageId }),
      ...(message.uid != null && { bounce_uid: message.uid }),
    };

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: jobsWithLeads } = await this.supabase
      .from('message_jobs')
      .select('id, campaign_id, enrollment_id, lead_id, sent_at, created_at, message_type, message_data')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(100);

    if (!jobsWithLeads || jobsWithLeads.length === 0) return;

    const leadIds = [...new Set(jobsWithLeads.map((j) => j.lead_id))];
    const { data: leads } = await this.supabase
      .from('leads')
      .select('id, email')
      .in('id', leadIds);
    const leadEmailById = new Map((leads || []).map((l) => [l.id, (l.email || '').toLowerCase()]));

    const candidateSet = new Set(candidateEmails);
    const matchedJobs = jobsWithLeads.filter((j) => candidateSet.has(leadEmailById.get(j.lead_id) || ''));

    if (matchedJobs.length === 0) {
      console.log(
        JSON.stringify({
          tag: 'bounce_unmatched',
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.email_address,
          bounceMessageId: message.messageId ?? null,
          bounceUid: message.uid ?? null,
          candidateEmails: candidateEmails.slice(0, 20),
          recentSentJobCount: jobsWithLeads.length,
          severity: classification.severity,
        })
      );
      return;
    }

    const { data: account } = await this.supabase
      .from('accounts')
      .select('suppress_bounced_emails')
      .eq('id', mailbox.account_id)
      .single();
    const suppressBouncedEmails = account?.suppress_bounced_emails !== false;

    const canonicalJob = this.selectBounceJobCandidate(matchedJobs as MessageJob[]);
    if (!canonicalJob) return;

    if (matchedJobs.length > 1) {
      console.log(
        JSON.stringify({
          tag: 'bounce_multi_match',
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.email_address,
          bounceMessageId: normalizedBounceMessageId ?? null,
          bounceUid: message.uid ?? null,
          candidateEmails: candidateEmails.slice(0, 20),
          candidateJobs: matchedJobs.map((job) => ({
            id: job.id,
            campaign_id: job.campaign_id,
            enrollment_id: job.enrollment_id,
            lead_id: job.lead_id,
            sent_at: job.sent_at,
            message_type: (job as MessageJob).message_type ?? null,
          })),
          selectedJobId: canonicalJob.id,
          selectedMessageType: canonicalJob.message_type ?? null,
        })
      );
    }

    const { data: inserted, error } = await this.supabase.rpc('record_bounced_event_and_increment', {
      p_campaign_id: canonicalJob.campaign_id,
      p_lead_id: canonicalJob.lead_id,
      p_enrollment_id: canonicalJob.enrollment_id,
      p_message_job_id: canonicalJob.id,
      p_mailbox_id: mailbox.id,
      p_event_data: eventDataBase,
    });
    if (error) {
      console.error(
        `[INBOX CHECKER] Failed to record bounced event and increment campaign_stats for campaign ${canonicalJob.campaign_id}:`,
        error
      );
      reportErrorToSlack('Inbox-checker: record_bounced_event_and_increment failed', {
        severity: 'warning',
        campaign_id: canonicalJob.campaign_id,
        message_job_id: canonicalJob.id,
        error: error.message,
        alertPolicy: isRetryableSupabaseReadError(error.message)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `inbox-record-bounced:${canonicalJob.campaign_id}`,
        summaryFields: {
          campaign_id: canonicalJob.campaign_id,
        },
      });
      return;
    }

    if (!inserted) {
      console.log(
        `[INBOX CHECKER] Bounce already recorded in RPC, skipping side effects for mailbox ${mailbox.id}, job ${canonicalJob.id}`
      );
      return;
    }

    if (classification.severity === 'hard' && suppressBouncedEmails) {
      const leadEmail = leadEmailById.get(canonicalJob.lead_id);
      if (leadEmail) {
        await this.supabase.from('block_list').upsert(
          { account_id: mailbox.account_id, value: leadEmail, type: 'email', reason: 'bounced' },
          { onConflict: 'account_id,value,type', ignoreDuplicates: true }
        );
      }
    }

    await emitWebhookEvent(this.supabase, {
      accountId: mailbox.account_id,
      campaignId: canonicalJob.campaign_id,
      eventType: 'bounce.detected',
      payload: {
        campaign_id: canonicalJob.campaign_id,
        lead_id: canonicalJob.lead_id,
        enrollment_id: canonicalJob.enrollment_id,
        message_job_id: canonicalJob.id,
        mailbox_id: mailbox.id,
        severity: classification.severity,
        code: classification.smtpCode ?? null,
        bounce_message_id: normalizedBounceMessageId ?? null,
        bounce_uid: message.uid ?? null,
        candidate_emails: candidateEmails,
        matched_job_count: matchedJobs.length,
      },
      dedupeKey: `bounce.detected:${mailbox.id}:${normalizedBounceMessageId ?? `uid:${message.uid}`}`,
    });

    const stoppedAt = new Date().toISOString();
    await this.supabase
      .from('enrollments')
      .update({ state: 'stopped', stopped_reason: 'bounced', stopped_at: stoppedAt })
      .eq('id', canonicalJob.enrollment_id)
      .is('deleted_at', null);

    // Held-job hygiene: a stopped enrollment must never leave restorable holds.
    const { error: heldCancelError } = await this.supabase.rpc('cancel_held_jobs_for_enrollment', {
      p_enrollment_id: canonicalJob.enrollment_id,
    });
    if (heldCancelError) {
      console.error(
        `[INBOX CHECKER] Failed to cancel held jobs for bounced enrollment ${canonicalJob.enrollment_id}:`,
        heldCancelError
      );
    }

    console.log(
      `Bounce detected in mailbox ${mailbox.id}, stopped 1 enrollment(s), matchedJobs=${matchedJobs.length}, selectedJob=${canonicalJob.id}, severity=${classification.severity}`
    );
  }

  /**
   * Handle an unsubscribe message
   */
  async autoBlockUnsubscribe(mailbox: Mailbox, message: ProcessedMessage): Promise<void> {
    const senderEmail = this.normalizeEmail(message.from.address);
    if (!senderEmail) return;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Scope to recent sent jobs for this mailbox, then match by the actual sender email.
    const { data: recentJobs } = await this.supabase
      .from('message_jobs')
      .select('id, campaign_id, enrollment_id, lead_id, sent_at')
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(100);

    if (!recentJobs || recentJobs.length === 0) return;

    const leadIds = [...new Set(recentJobs.map((job: any) => job.lead_id))];
    const { data: leads } = await this.supabase
      .from('leads')
      .select('id, email')
      .in('id', leadIds);

    const leadEmailById = new Map(
      (leads || []).map((lead: any) => [lead.id, this.normalizeEmail(lead.email)])
    );
    const matchedJobs = recentJobs.filter(
      (job: any) => leadEmailById.get(job.lead_id) === senderEmail
    );

    if (matchedJobs.length === 0) {
      console.log(
        JSON.stringify({
          tag: 'unsubscribe_unmatched',
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.email_address,
          senderEmail,
          recentSentJobCount: recentJobs.length,
        })
      );
      return;
    }

    await this.supabase.from('block_list').upsert(
      {
        account_id: mailbox.account_id,
        value: senderEmail,
        type: 'email',
        reason: 'unsubscribed',
      },
      { onConflict: 'account_id,value,type', ignoreDuplicates: true }
    );

    console.log(
      `Auto-blocked unsubscribe sender in mailbox ${mailbox.id}: ${senderEmail}, matchedJobs=${matchedJobs.length}`
    );
  }
}
