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
import {
  loadCampaignCategorizerConfig,
  type CampaignCategorizerConfigLoad,
} from './campaign-categorizer-config.js';
import {
  resolveCampaignReplyDisposition,
  shouldAttemptCategorizerPark,
} from './campaign-reply-disposition.js';
import { isAutoReplyMessage } from './message-processor.js';
import { emitClassifyReplyJob } from './emit-classify-reply-job.js';
import { emitEmailReceivedNotification } from './emit-notification-event.js';
import { emitWebhookEvent } from './emit-webhook-event.js';
import { buildBounceDetectedWebhookPayload } from './bounce-detected-webhook-payload.js';
import {
  buildReplyReceivedWebhookPayload,
  campaignNameFromRelation,
} from './reply-received-webhook-payload.js';
import { buildUnsubscribeDetectedWebhookPayload } from './unsubscribe-detected-webhook-payload.js';
import {
  LEAD_WEBHOOK_IDENTITY_COLUMNS,
  type LeadIdentityRow,
} from '@furnace/webhooks-lib';
import {
  containsUnresolvedTemplate,
  formatReferencesHeader,
  isNoSubjectPlaceholder,
  normalizeMessageId as normalizeMessageIdShared,
  normalizeThreadTopic,
  parseMessageIds,
  resolveDeliveredSubject,
} from '@furnace/email-lib';
import {
  backfillSentMessages as backfillCampaignSentMessages,
  normalizeMessageId,
} from './backfill-sent-messages.js';
import {
  FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC,
  SENT_JOB_REPLY_SELECT,
} from './sentJobMessageIdLookup.js';

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
  /**
   * Per-campaign categorizer lookup cache (TTL = one worker tick).
   * Only successful lookups are cached — never cache lookup errors as
   * hasCategorizer=false (that fail-open orphaned Interested enrollments).
   */
  private categorizerCache = new Map<string, { value: CampaignCategorizerConfigLoad; expiresAt: number }>();

  constructor(private supabase: SupabaseClient) {}

  /**
   * Whether the campaign's flow contains a live categorizer node.
   * Successful results are cached; errors are not (retry next call).
   */
  private async getCampaignCategorizerConfig(
    campaignId: string,
  ): Promise<CampaignCategorizerConfigLoad> {
    const cached = this.categorizerCache.get(campaignId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value = await loadCampaignCategorizerConfig(this.supabase, campaignId);
    if (value.status === 'error') {
      // One immediate retry before treating as configError.
      value = await loadCampaignCategorizerConfig(this.supabase, campaignId);
    }
    if (value.status === 'ok') {
      this.categorizerCache.set(campaignId, {
        value,
        expiresAt: Date.now() + CATEGORIZER_CACHE_TTL_MS,
      });
    }
    return value;
  }

  /**
   * Normalize Message-ID for consistent storage and matching
   * - Removes angle brackets (< >)
   * - Converts to lowercase (Message-IDs are case-insensitive per RFC 5322)
   * - Returns null if input is null/empty
   */
  private normalizeMessageId(messageId: string | null | undefined): string | null {
    return normalizeMessageId(messageId);
  }

  private normalizeEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    return email.trim().toLowerCase() || null;
  }

  private collectTrimmedAddresses(
    entries: Array<{ name?: string; address: string }> | null | undefined
  ): string[] {
    if (!entries?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of entries) {
      const trimmed = entry.address?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  private mergeThreadParticipants(
    existing: string[],
    additions: Array<string | null | undefined>
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [...existing, ...additions]) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
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
    const exactMatches = jobs.filter(
      (job) =>
        this.normalizeMessageId(job.provider_message_id) === searchId ||
        this.normalizeMessageId(job.submitted_message_id) === searchId,
    );
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

    if (messageType === 'campaign_reply' || messageType === 'campaign_priority') {
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
      this.logReplyMatch(false, 'missing_message_id', mailbox, message);
      return false;
    }

    // Confidence order: In-Reply-To first, then References newest → oldest
    const inReplyToId = this.normalizeMessageId(message.inReplyTo);
    const referenceIds =
      message.referenceMessageIds?.length > 0
        ? message.referenceMessageIds.map((id) => normalizeMessageIdShared(id)).filter((id): id is string => Boolean(id))
        : parseMessageIds(message.references);
    const messageIdsToSearch: string[] = [];
    if (inReplyToId) messageIdsToSearch.push(inReplyToId);
    for (let i = referenceIds.length - 1; i >= 0; i--) {
      const id = referenceIds[i]!;
      if (!messageIdsToSearch.includes(id)) messageIdsToSearch.push(id);
    }

    // Check if this message already exists (duplicate check)
    const { data: existingMessages } = await this.supabase
      .from('email_messages')
      .select('id, thread_id, received_at')
      .eq('account_id', mailbox.account_id)
      .eq('message_id', normalizedMessageId)
      .order('created_at', { ascending: true })
      .limit(1);

    const existingMessage = existingMessages?.[0] as
      | { id: string; thread_id: string | null; received_at: string | null }
      | undefined;

    if (existingMessage) {
      console.log(`[INBOX CHECKER] Message ${normalizedMessageId} already processed, re-emitting notification event`);
      // Heal dropped SQS: re-enqueue even when the email_messages row already exists.
      if (existingMessage.thread_id) {
        await emitEmailReceivedNotification(this.supabase, {
          accountId: mailbox.account_id,
          threadId: existingMessage.thread_id,
          emailMessageId: existingMessage.id,
          mailboxId: mailbox.id,
          fromEmail: message.from.address,
          fromName: message.from.name || null,
          subject: message.subject,
          receivedAt: existingMessage.received_at || message.date.toISOString(),
        });
      }
      this.logReplyMatch(true, 'duplicate', mailbox, message);
      return true; // Already processed, return success
    }

    let thread: any;
    let originalJob: MessageJob | null = null;
    let isReplyToOriginal = false;
    // Backfill ceiling: all campaign sends that existed by the time of this reply
    const replyCutoffTime = message.date.toISOString();

    // Exact header match against outbound jobs (provider or submitted Message-ID).
    // One indexed equality lookup for all candidate ids; walk in confidence order.
    let foundJob: MessageJob | null = null;
    if (messageIdsToSearch.length > 0) {
      const sentJobs = await this.findSentJobsByMessageIds(mailbox, messageIdsToSearch);
      for (const searchId of messageIdsToSearch) {
        foundJob = this.selectReplyJobCandidate(sentJobs, mailbox, searchId);
        if (foundJob) break;
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
          this.logReplyMatch(false, 'inbox_job_missing_thread', mailbox, message);
          return false;
        }
        thread = existingThread;
        if (existingThread.campaign_id && existingThread.lead_id) {
          await this.backfillSentMessages(
            existingThread,
            existingThread.campaign_id,
            existingThread.lead_id,
            replyCutoffTime,
            mailbox
          );
        }
      } else {
        // Campaign send: get or create thread by message_job_id
        thread = await this.getOrCreateThread(
          originalJob as MessageJob,
          mailbox,
          replyCutoffTime
        );
      }
      this.logReplyMatch(true, 'exact_job', mailbox, message);
    } else {
      // Match against existing email_messages Message-IDs
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

      // Exact Outlook conversation key (Thread-Index) when present
      if ((!parentMessage || !parentMessage.thread_id) && message.threadIndex) {
        const { data: byIndex } = await this.supabase
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
          .eq('thread_index', message.threadIndex)
          .order('created_at', { ascending: true })
          .limit(10);
        if (byIndex && byIndex.length > 0) {
          parentMessage = this.selectParentMessageCandidate(
            byIndex as ParentMessageCandidate[],
            mailbox,
          );
        }
      }

      if (parentMessage?.thread_id) {
        const { data: existingThread, error: threadError } = await this.supabase
          .from('email_threads')
          .select('*')
          .eq('id', parentMessage.thread_id)
          .single();

        if (threadError || !existingThread) {
          console.error('Error loading thread for reply-to-reply:', threadError);
          this.logReplyMatch(false, 'parent_thread_missing', mailbox, message);
          return false;
        }

        thread = existingThread;
        if (existingThread.campaign_id && existingThread.lead_id) {
          await this.backfillSentMessages(
            existingThread,
            existingThread.campaign_id,
            existingThread.lead_id,
            replyCutoffTime,
            mailbox
          );
        }
        this.logReplyMatch(true, 'exact_message', mailbox, message);
      } else {
        // Headers point at our outbound domain but parent not present yet → stage
        const looksLikeOurs = messageIdsToSearch.some((id) => id.endsWith('@furnace.build'));
        if (looksLikeOurs && messageIdsToSearch.length > 0) {
          await this.stagePendingInboundReply(mailbox, message, normalizedMessageId, inReplyToId, referenceIds);
          this.logReplyMatch(false, 'parent_not_found_staged', mailbox, message);
          return false;
        }

        // No usable headers / no exact match: attach only if clearly a reply to our outbound
        const guessed = await this.findBestGuessThreadForOutboundReply(mailbox, message);
        if (!guessed) {
          this.logReplyMatch(
            false,
            messageIdsToSearch.length === 0 ? 'no_outbound_relationship' : 'headers_unresolved',
            mailbox,
            message,
          );
          return false;
        }
        thread = guessed;
        if (guessed.campaign_id && guessed.lead_id) {
          await this.backfillSentMessages(
            guessed,
            guessed.campaign_id,
            guessed.lead_id,
            replyCutoffTime,
            mailbox,
          );
        }
        // Best-guess among our threads: treat like original-match for enrollment side effects
        // when the thread still has a root campaign message_job_id.
        if (guessed.message_job_id) {
          const { data: rootJob } = await this.supabase
            .from('message_jobs')
            .select(SENT_JOB_REPLY_SELECT)
            .eq('id', guessed.message_job_id)
            .maybeSingle();
          if (rootJob) {
            originalJob = rootJob as unknown as MessageJob;
            isReplyToOriginal = true;
          }
        }
        this.logReplyMatch(true, 'best_guess', mailbox, message);
      }
    }

    const referenceMessageIds =
      referenceIds.length > 0 ? referenceIds : parseMessageIds(message.references);
    const messageReferencesHeader =
      formatReferencesHeader(referenceMessageIds) ?? message.references;
    const threadTopic =
      message.threadTopic ?? normalizeThreadTopic(message.subject);

    const toEmails = this.collectTrimmedAddresses(message.to);
    const ccEmails = this.collectTrimmedAddresses(message.cc);

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
        to_emails: toEmails.length > 0 ? toEmails : null,
        cc: ccEmails.length > 0 ? ccEmails : null,
        subject: message.subject,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        message_id: normalizedMessageId, // Store normalized version
        in_reply_to: inReplyToId,
        message_references: messageReferencesHeader,
        reference_message_ids: referenceMessageIds.length > 0 ? referenceMessageIds : null,
        thread_topic: threadTopic,
        thread_index: message.threadIndex,
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
        console.log(
          `[INBOX CHECKER] Message ${normalizedMessageId} already exists (race condition), re-emitting notification event`
        );
        const { data: racedMessages } = await this.supabase
          .from('email_messages')
          .select('id, thread_id, received_at')
          .eq('account_id', mailbox.account_id)
          .eq('message_id', normalizedMessageId)
          .order('created_at', { ascending: true })
          .limit(1);
        const raced = racedMessages?.[0] as
          | { id: string; thread_id: string | null; received_at: string | null }
          | undefined;
        if (raced?.thread_id) {
          await emitEmailReceivedNotification(this.supabase, {
            accountId: mailbox.account_id,
            threadId: raced.thread_id,
            emailMessageId: raced.id,
            mailboxId: mailbox.id,
            fromEmail: message.from.address,
            fromName: message.from.name || null,
            subject: message.subject,
            receivedAt: raced.received_at || message.date.toISOString(),
          });
        }
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

    const inboundAt = message.date.toISOString();
    const threadUpdateBase = {
      has_reply: true,
      last_message_at: inboundAt,
      last_inbound_at: inboundAt,
      participants: this.mergeThreadParticipants(
        thread.participants || [],
        [
          message.from.address,
          ...message.to.map((t) => t.address),
          ...(message.cc ?? []).map((c) => c.address),
        ],
      ),
      conversation_status: inboundIsAutoReply ? 'closed' : 'open',
      conversation_status_source: 'system',
      classification_status: inboundIsAutoReply ? 'complete' : 'pending',
      classification_requested_at: inboundAt,
      classification_completed_at: inboundIsAutoReply ? inboundAt : null,
      ...OOO_CLEAR_FOR_NEW_INBOUND_REPLY,
      ...threadCategoryPatch,
    };

    // Update thread: set has_reply = true, update last_message_at / last_inbound_at
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
          ...threadUpdateBase,
          message_count: fallbackCount,
        })
        .eq('id', thread.id);
    } else {
      await this.supabase
        .from('email_threads')
        .update({
          ...threadUpdateBase,
          message_count: actualMessageCount || 1, // Use actual count to avoid race conditions
        })
        .eq('id', thread.id);
    }

    // Only act on the enrollment if this is a reply to the original sent message
    // (not a reply to a reply)
    let queueHasCategorizer = false;
    let queueUseAi = false;
    if (isReplyToOriginal && originalJob) {
      const isCampaignReply =
        (originalJob as any).message_type !== 'inbox_reply' &&
        (originalJob as any).message_type !== 'inbox_forward' &&
        (originalJob as any).message_data?.source !== 'inbox_reply' &&
        (originalJob as any).message_data?.source !== 'inbox_forward';

      // Categorizer flows: hold outbound and fast-forward to the categorizer.
      // Unsubscribe keeps the legacy hard stop. Park/config misses must NOT
      // fail open to hard-stop (that orphaned AI Interested threads).
      let parkStatus: string | null = null;
      let parkRpcError = false;
      let replyThreadIdAlreadySet = false;

      const categorizerLoad =
        isCampaignReply && !!originalJob.enrollment_id && originalJob.campaign_id
          ? await this.getCampaignCategorizerConfig(originalJob.campaign_id)
          : ({ status: 'ok', hasCategorizer: false, useAi: false } as const);
      const configError = categorizerLoad.status === 'error';
      const hasCategorizer = categorizerLoad.status === 'ok' && categorizerLoad.hasCategorizer;
      const useAi = categorizerLoad.status === 'ok' ? categorizerLoad.useAi : false;
      queueHasCategorizer = hasCategorizer || configError;
      queueUseAi = useAi;

      if (isCampaignReply && originalJob.enrollment_id) {
        const { data: enrollmentRow } = await this.supabase
          .from('enrollments')
          .select('reply_thread_id')
          .eq('id', originalJob.enrollment_id)
          .maybeSingle();
        replyThreadIdAlreadySet = !!(enrollmentRow as { reply_thread_id?: string | null } | null)
          ?.reply_thread_id;
      }

      const attemptPark = shouldAttemptCategorizerPark({
        isCampaignReply,
        hasEnrollmentId: !!originalJob.enrollment_id,
        isUnsubscribe: !!options?.isUnsubscribe,
        hasCategorizer,
        configError,
      });

      if (attemptPark && originalJob.enrollment_id) {
        const { data: parkResult, error: parkError } = await this.supabase.rpc(
          'park_or_advance_enrollment_on_reply',
          {
            p_enrollment_id: originalJob.enrollment_id,
            p_thread_id: thread.id,
          }
        );

        if (parkError) {
          parkRpcError = true;
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
          if (parkStatus === 'branched') {
            replyThreadIdAlreadySet = true;
          }
        }
      }

      const disposition = resolveCampaignReplyDisposition({
        isCampaignReply,
        isUnsubscribe: !!options?.isUnsubscribe,
        replyThreadIdAlreadySet,
        hasCategorizer,
        configError,
        parkStatus,
        parkError: parkRpcError,
      });

      console.log(
        `[INBOX CHECKER] Reply disposition=${disposition} parkStatus=${parkStatus ?? 'null'} ` +
          `configError=${configError} enrollment=${originalJob.enrollment_id}`
      );

      if (disposition === 'park_ok') {
        if (parkStatus === 'held' || parkStatus === 'woken' || parkStatus === 'branched') {
          console.log(
            `[INBOX CHECKER] Reply routed to categorizer (${parkStatus}) for enrollment ${originalJob.enrollment_id}`
          );
        }
      } else if (disposition === 'leave_active_alert') {
        reportErrorToSlack(
          'Inbox-checker: categorizer park missed — enrollment left active (not hard-stopped)',
          {
            severity: 'critical',
            campaign_id: originalJob.campaign_id,
            enrollment_id: originalJob.enrollment_id,
            thread_id: thread.id,
            error: `parkStatus=${parkStatus ?? 'null'} configError=${configError} parkError=${parkRpcError}`,
            alertPolicy: 'critical_failure',
            aggregationKey: `categorizer-park-miss:${originalJob.campaign_id}`,
            summaryFields: {
              campaign_id: originalJob.campaign_id,
            },
          },
        );
      } else {
        // hard_stop — legacy non-categorizer or unsubscribe
        const stoppedAt = new Date().toISOString();
        await this.supabase
          .from('enrollments')
          .update({ state: 'stopped', stopped_reason: 'replied', stopped_at: stoppedAt })
          .eq('id', originalJob.enrollment_id)
          .is('deleted_at', null);

        if (hasCategorizer || configError) {
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
        `Reply to original message detected and processed: message_job ${originalJob.id}, enrollment ${originalJob.enrollment_id} disposition=${disposition}`
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

    if (!queueHasCategorizer && thread.campaign_id) {
      const fallbackCategorizerConfig = await this.getCampaignCategorizerConfig(thread.campaign_id);
      if (fallbackCategorizerConfig.status === 'ok') {
        queueHasCategorizer = fallbackCategorizerConfig.hasCategorizer;
        queueUseAi = fallbackCategorizerConfig.useAi;
      } else {
        // Lookup failed: still queue classify so AI can run; useAi unknown → false.
        queueHasCategorizer = true;
        queueUseAi = false;
      }
    }
    await emitClassifyReplyJob({
      emailMessageId: emailMessage.id,
      threadId: thread.id,
      enrollmentId: thread.enrollment_id ?? null,
      campaignId: thread.campaign_id ?? null,
      hasCategorizer: queueHasCategorizer,
      useAi: queueUseAi,
    });

    if (isReplyToOriginal && originalJob) {
      const { data: replyLead } = await this.supabase
        .from('leads')
        .select(LEAD_WEBHOOK_IDENTITY_COLUMNS)
        .eq('id', originalJob.lead_id)
        .maybeSingle();
      await emitWebhookEvent(this.supabase, {
        accountId: thread.account_id,
        campaignId: originalJob.campaign_id,
        eventType: 'reply.received',
        payload: buildReplyReceivedWebhookPayload({
          threadId: thread.id,
          emailMessageId: emailMessage.id,
          campaignId: originalJob.campaign_id,
          campaignName: campaignNameFromRelation(originalJob.campaigns),
          leadId: originalJob.lead_id,
          enrollmentId: originalJob.enrollment_id,
          mailboxId: mailbox.id,
          mailboxEmail: mailbox.email_address,
          fromEmail: message.from.address,
          subject: message.subject,
          bodyText: message.bodyText,
          receivedAt: emailMessage.received_at,
          lead: (replyLead as LeadIdentityRow | null) ?? null,
        }),
        dedupeKey: `reply.received:${emailMessage.id}`,
      });
    }

    await this.clearPendingInboundReply(mailbox.account_id, normalizedMessageId);
    return true;
  }

  private logReplyMatch(
    matched: boolean,
    reason: string,
    mailbox: Mailbox,
    message: ProcessedMessage,
  ): void {
    // For unmatched messages, suppress log if the message has no threading headers
    // (avoids noise from unrelated inbound mail that was never a reply to us)
    const hasThreadingHeaders =
      !!message.inReplyTo || (message.referenceMessageIds?.length ?? 0) > 0;
    if (!matched && !hasThreadingHeaders) return;

    // subject_preview: max 40 chars, no raw email addresses logged
    const subjectPreview = (message.subject ?? '').slice(0, 40);

    console.log(
      JSON.stringify({
        tag: matched ? 'reply_matched' : 'reply_unmatched',
        reason,
        mailbox_id: mailbox.id,
        account_id: mailbox.account_id,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        references_count: message.referenceMessageIds?.length ?? 0,
        subject_preview: subjectPreview,
      }),
    );
  }

  private async findSentJobsByMessageIds(
    mailbox: Mailbox,
    searchIds: string[],
  ): Promise<MessageJob[]> {
    if (searchIds.length === 0) return [];

    const { data: jobs, error: jobError } = await this.supabase.rpc(
      FIND_SENT_JOBS_BY_MESSAGE_IDS_RPC,
      {
        p_account_id: mailbox.account_id,
        p_search_ids: searchIds,
        p_limit: 40,
      },
    );

    if (jobError) {
      console.error(
        JSON.stringify({
          tag: 'sent_job_message_id_lookup_failed',
          account_id: mailbox.account_id,
          search_id_count: searchIds.length,
          code: (jobError as { code?: string }).code ?? null,
          error: jobError.message,
        }),
      );
      return [];
    }
    if (!jobs || jobs.length === 0) return [];
    return jobs as MessageJob[];
  }

  private async stagePendingInboundReply(
    mailbox: Mailbox,
    message: ProcessedMessage,
    normalizedMessageId: string,
    inReplyToId: string | null,
    referenceIds: string[],
  ): Promise<void> {
    const payload = {
      uid: message.uid,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      references: message.references,
      referenceMessageIds: referenceIds,
      threadTopic: message.threadTopic,
      threadIndex: message.threadIndex,
      from: message.from,
      to: message.to,
      cc: message.cc ?? [],
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      date: message.date.toISOString(),
      headers: message.headers,
      attachments: message.attachments,
    };

    const { error } = await this.supabase.from('pending_inbound_replies').upsert(
      {
        account_id: mailbox.account_id,
        mailbox_id: mailbox.id,
        message_id: normalizedMessageId,
        in_reply_to: inReplyToId,
        reference_message_ids: referenceIds,
        payload,
        reason: 'parent_not_found',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,message_id' },
    );

    if (error) {
      console.error('[INBOX CHECKER] Failed to stage pending inbound reply:', error);
    } else {
      console.log(
        `[INBOX CHECKER] Staged pending inbound reply ${normalizedMessageId} (parent not found yet)`,
      );
    }
  }

  private async clearPendingInboundReply(accountId: string, messageId: string): Promise<void> {
    await this.supabase
      .from('pending_inbound_replies')
      .delete()
      .eq('account_id', accountId)
      .eq('message_id', messageId);
  }

  /**
   * Retry child-before-parent staged replies for this mailbox.
   */
  async retryPendingInboundReplies(mailbox: Mailbox): Promise<number> {
    const { data: rows, error } = await this.supabase
      .from('pending_inbound_replies')
      .select('*')
      .eq('mailbox_id', mailbox.id)
      .order('created_at', { ascending: true })
      .limit(25);

    if (error || !rows?.length) return 0;

    let attached = 0;
    for (const row of rows) {
      const payload = row.payload as Record<string, unknown>;
      const processed: ProcessedMessage = {
        uid: Number(payload.uid ?? 0),
        messageId: (payload.messageId as string) ?? row.message_id,
        inReplyTo: (payload.inReplyTo as string) ?? row.in_reply_to,
        references: (payload.references as string) ?? null,
        referenceMessageIds: Array.isArray(payload.referenceMessageIds)
          ? (payload.referenceMessageIds as string[])
          : (row.reference_message_ids as string[]) ?? [],
        threadTopic: (payload.threadTopic as string) ?? null,
        threadIndex: (payload.threadIndex as string) ?? null,
        from: (payload.from as ProcessedMessage['from']) ?? { address: '' },
        to: (payload.to as ProcessedMessage['to']) ?? [],
        cc: Array.isArray(payload.cc)
          ? (payload.cc as ProcessedMessage['cc'])
          : [],
        subject: String(payload.subject ?? ''),
        bodyText: (payload.bodyText as string) ?? null,
        bodyHtml: (payload.bodyHtml as string) ?? null,
        date: new Date(String(payload.date ?? row.created_at)),
        headers: (payload.headers as ProcessedMessage['headers']) ?? {},
        attachments: (payload.attachments as ProcessedMessage['attachments']) ?? [],
      };

      await this.supabase
        .from('pending_inbound_replies')
        .update({
          attempts: (row.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      const ok = await this.handleReply(mailbox, processed);
      if (ok) attached += 1;
    }
    return attached;
  }

  /**
   * When headers are missing/unusable: attach only if clearly a reply to mail we sent
   * from this mailbox to this participant. If multiple of our threads fit, pick best guess.
   */
  private async findBestGuessThreadForOutboundReply(
    mailbox: Mailbox,
    message: ProcessedMessage,
  ): Promise<any | null> {
    const fromEmail = this.normalizeEmail(message.from.address);
    if (!fromEmail) return null;

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentJobs } = await this.supabase
      .from('message_jobs')
      .select('id, campaign_id, lead_id, mailbox_id, sent_at, message_data, provider_message_id, leads(email)')
      .eq('account_id', mailbox.account_id)
      .eq('mailbox_id', mailbox.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .or(
        'message_type.is.null,message_type.eq.campaign,message_type.eq.campaign_priority,message_type.eq.campaign_reply,message_type.eq.inbox_reply',
      )
      .order('sent_at', { ascending: false })
      .limit(50);

    if (!recentJobs?.length) return null;

    const matchingJobs = recentJobs.filter((job: any) => {
      const leadEmail = this.normalizeEmail(job.leads?.email);
      const toEmail = this.normalizeEmail(job.message_data?.to_email);
      return leadEmail === fromEmail || toEmail === fromEmail;
    });
    if (matchingJobs.length === 0) return null;

    const inboundTopic = normalizeThreadTopic(message.subject);
    const scored = matchingJobs.map((job: any) => {
      const sentSubject =
        typeof job.message_data?.sent_subject === 'string'
          ? job.message_data.sent_subject
          : typeof job.message_data?.subject === 'string'
            ? job.message_data.subject
            : '';
      const sentTopic = normalizeThreadTopic(sentSubject);
      let score = 1;
      if (inboundTopic && sentTopic && inboundTopic === sentTopic) score += 5;
      else if (
        inboundTopic &&
        sentTopic &&
        (inboundTopic.includes(sentTopic) || sentTopic.includes(inboundTopic))
      ) {
        score += 2;
      }
      const ageMs = Date.now() - new Date(job.sent_at).getTime();
      score += Math.max(0, 3 - ageMs / (7 * 24 * 60 * 60 * 1000));
      return { job, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    // Prefer subject agreement when available; still allow recency-only when clearly ours
    if (inboundTopic && best.score < 2) return null;

    const bestJob = best.job;
    const threadIdFromMd = bestJob.message_data?.thread_id as string | undefined;
    if (threadIdFromMd) {
      const { data: thread } = await this.supabase
        .from('email_threads')
        .select('*')
        .eq('id', threadIdFromMd)
        .eq('account_id', mailbox.account_id)
        .maybeSingle();
      if (thread) return thread;
    }

    const { data: byJob } = await this.supabase
      .from('email_threads')
      .select('*')
      .eq('account_id', mailbox.account_id)
      .eq('message_job_id', bestJob.id)
      .maybeSingle();
    if (byJob) return byJob;

    // Campaign thread may be keyed by first send — look up by campaign+lead
    if (bestJob.campaign_id && bestJob.lead_id) {
      const { data: byLead } = await this.supabase
        .from('email_threads')
        .select('*')
        .eq('account_id', mailbox.account_id)
        .eq('mailbox_id', mailbox.id)
        .eq('campaign_id', bestJob.campaign_id)
        .eq('lead_id', bestJob.lead_id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byLead) return byLead;
    }

    return null;
  }

  /**
   * Get or create email thread for a message_job.
   * @param cutoffTime ISO timestamp of the inbound reply; backfill includes all
   *   campaign sends for this campaign+lead with sent_at <= cutoffTime.
   */
  private async getOrCreateThread(
    messageJob: MessageJob,
    mailbox: Mailbox,
    cutoffTime: string
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
      await this.backfillSentMessages(
        existingThread,
        messageJob.campaign_id,
        messageJob.lead_id,
        cutoffTime,
        mailbox
      );
      return await this.healThreadSubjectIfUnrendered(existingThread, messageJob);
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
        cutoffTime,
        mailbox
      );
      return await this.healThreadSubjectIfUnrendered(existingCampaignThread, messageJob);
    }

    const messageData = messageJob.message_data || {};
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

    // Rule 15: prefer recorded delivered subjects, and render rather than store a
    // raw template. An empty subject is legitimate; the UI supplies the placeholder.
    const subject = resolveDeliveredSubject({
      eventSentSubject: firstSentEvent?.event_data?.sent_subject ?? null,
      messageDataSentSubject: messageData.sent_subject ?? null,
      messageDataSubject: messageData.subject ?? null,
      nodeConfigSubject: messageData.node_config?.subject ?? null,
      lead: messageJob.leads ?? null,
    });

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
          await this.backfillSentMessages(
            racedThread,
            messageJob.campaign_id,
            messageJob.lead_id,
            cutoffTime,
            mailbox
          );
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

    // Backfill all campaign sends for this campaign+lead up through reply time
    await this.backfillSentMessages(
      newThread,
      messageJob.campaign_id,
      messageJob.lead_id,
      cutoffTime,
      mailbox
    );

    return newThread;
  }

  /**
   * Repair a thread title that was frozen before subject resolution existed.
   *
   * Threads created by older code could store a raw spintax template or the UI's
   * "(No subject)" placeholder, which then showed verbatim in the inbox and
   * seeded composer replies. Healing on read keeps existing threads correct
   * without waiting on a migration.
   */
  private async healThreadSubjectIfUnrendered(thread: any, messageJob: any): Promise<any> {
    const stored = thread?.subject;
    if (!containsUnresolvedTemplate(stored) && !isNoSubjectPlaceholder(stored)) {
      return thread;
    }

    const messageData = messageJob.message_data || {};
    const healed = resolveDeliveredSubject({
      messageDataSentSubject: messageData.sent_subject ?? null,
      messageDataSubject: messageData.subject ?? null,
      nodeConfigSubject: messageData.node_config?.subject ?? stored ?? null,
      lead: messageJob.leads ?? null,
    });

    if (healed === stored) return thread;

    const { error } = await this.supabase
      .from('email_threads')
      .update({ subject: healed })
      .eq('id', thread.id);

    if (error) {
      console.error(`Failed to heal thread subject for ${thread.id}:`, error);
      return thread;
    }

    console.log(`[INBOX CHECKER] Healed unrendered subject on thread ${thread.id}`);
    return { ...thread, subject: healed };
  }

  /**
   * Backfill sent campaign messages into email_messages for a thread.
   * cutoffTime should be the inbound reply received_at so later follow-ups
   * that already sent before the reply are included (not matched-job sent_at).
   */
  private async backfillSentMessages(
    thread: any,
    campaignId: string,
    leadId: string,
    cutoffTime: string,
    mailbox: Mailbox
  ): Promise<void> {
    await backfillCampaignSentMessages(
      this.supabase,
      { id: thread.id, account_id: thread.account_id },
      campaignId,
      leadId,
      cutoffTime,
      {
        account_id: mailbox.account_id,
        email_address: mailbox.email_address,
        display_name: mailbox.display_name,
      }
    );
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
      .select(LEAD_WEBHOOK_IDENTITY_COLUMNS)
      .in('id', leadIds);
    const leadById = new Map(
      (leads || []).map((lead) => [lead.id, lead as LeadIdentityRow]),
    );
    const leadEmailById = new Map(
      [...leadById.entries()].map(([id, lead]) => [id, (lead.email || '').toLowerCase()]),
    );

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

    const { data: bounceCampaign } = await this.supabase
      .from('campaigns')
      .select('name')
      .eq('id', canonicalJob.campaign_id)
      .maybeSingle();

    await emitWebhookEvent(this.supabase, {
      accountId: mailbox.account_id,
      campaignId: canonicalJob.campaign_id,
      eventType: 'bounce.detected',
      payload: buildBounceDetectedWebhookPayload({
        campaignId: canonicalJob.campaign_id,
        campaignName: bounceCampaign?.name ?? null,
        lead: leadById.get(canonicalJob.lead_id) ?? null,
        leadId: canonicalJob.lead_id,
        enrollmentId: canonicalJob.enrollment_id,
        messageJobId: canonicalJob.id,
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.email_address,
        severity: classification.severity,
        code: classification.smtpCode ?? null,
        bounceMessageId: normalizedBounceMessageId ?? null,
        bounceUid: message.uid ?? null,
        candidateEmails,
        matchedJobCount: matchedJobs.length,
      }),
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
      .select(LEAD_WEBHOOK_IDENTITY_COLUMNS)
      .in('id', leadIds);

    const leadById = new Map(
      (leads || []).map((lead) => [lead.id, lead as LeadIdentityRow]),
    );
    const leadEmailById = new Map(
      [...leadById.entries()].map(([id, lead]) => [id, this.normalizeEmail(lead.email)]),
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

    const canonicalJob = matchedJobs[0] as {
      campaign_id: string;
      enrollment_id: string;
      lead_id: string;
    };
    const { data: unsubCampaign } = await this.supabase
      .from('campaigns')
      .select('name')
      .eq('id', canonicalJob.campaign_id)
      .maybeSingle();

    await emitWebhookEvent(this.supabase, {
      accountId: mailbox.account_id,
      campaignId: canonicalJob.campaign_id,
      eventType: 'unsubscribe.detected',
      payload: buildUnsubscribeDetectedWebhookPayload({
        campaignId: canonicalJob.campaign_id,
        campaignName: unsubCampaign?.name ?? null,
        lead: leadById.get(canonicalJob.lead_id) ?? null,
        leadId: canonicalJob.lead_id,
        enrollmentId: canonicalJob.enrollment_id,
        mailboxId: mailbox.id,
        mailboxEmail: mailbox.email_address,
      }),
      dedupeKey: `unsubscribe.detected:${mailbox.id}:${senderEmail}:${canonicalJob.campaign_id}`,
    });

    console.log(
      `Auto-blocked unsubscribe sender in mailbox ${mailbox.id}: ${senderEmail}, matchedJobs=${matchedJobs.length}`
    );
  }
}
