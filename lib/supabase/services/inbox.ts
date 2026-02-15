import { supabase } from '../client';
import type { EmailThread, EmailMessage } from '../types';
import { getDisplayBody } from '@/lib/email';

/** Attachment metadata stored on email_messages */
export interface AttachmentMeta {
  filename: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  part?: string;
  imapUid?: number;
}

export interface GetThreadsByAccountOptions {
  hasReplyOnly?: boolean;
  limit?: number;
  offset?: number;
  mailboxId?: string;
  campaignId?: string;
  unreadOnly?: boolean;
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
  searchQuery?: string;
  /** Filter by threads that have any of these tag IDs */
  tagIds?: string[];
  /** Filter by category */
  category?: string;
  /** When true, returned threads include unread_count (requires extra query) */
  includeUnreadCount?: boolean;
}

export type EmailThreadWithUnread = EmailThread & { unread_count: number };

/**
 * List email threads for an account.
 * Ordered by last_message_at descending (newest first).
 * Optionally filter to threads that have at least one reply (has_reply = true).
 */
export async function getThreadsByAccount(
  accountId: string,
  options?: GetThreadsByAccountOptions
): Promise<EmailThread[]> {
  // When unreadOnly is set, we need to filter to threads with unread received messages.
  // Two-query approach: first get thread IDs, then fetch threads.
  if (options?.unreadOnly === true) {
    const { data: unreadThreadIds } = await supabase
      .from('email_messages')
      .select('thread_id')
      .eq('direction', 'received')
      .is('read_at', null);
    const threadIds = [...new Set((unreadThreadIds ?? []).map((r) => r.thread_id))];
    if (threadIds.length === 0) {
      return [];
    }
    // Fetch threads and join with email_threads to ensure account_id match
    const { data: threadsWithUnread } = await supabase
      .from('email_threads')
      .select('id')
      .eq('account_id', accountId)
      .in('id', threadIds);
    const ids = (threadsWithUnread ?? []).map((t) => t.id);
    if (ids.length === 0) {
      return [];
    }
    // Fall through to build query with .in('id', ids) - we'll need to merge this into the main query
    // Actually, let's refactor: we'll add the id filter to the main query.
    return getThreadsByAccountInternal(accountId, { ...options, restrictToThreadIds: ids });
  }

  return getThreadsByAccountInternal(accountId, options);
}

async function getThreadsByAccountInternal(
  accountId: string,
  options?: GetThreadsByAccountOptions & { restrictToThreadIds?: string[] }
): Promise<EmailThread[]> {
  let query = supabase
    .from('email_threads')
    .select('*')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false });

  if (options?.hasReplyOnly === true) {
    query = query.eq('has_reply', true);
  }

  if (options?.mailboxId) {
    query = query.eq('mailbox_id', options.mailboxId);
  }

  if (options?.campaignId) {
    query = query.eq('campaign_id', options.campaignId);
  }

  if (options?.dateFrom) {
    query = query.gte('last_message_at', options.dateFrom);
  }

  if (options?.dateTo) {
    query = query.lte('last_message_at', options.dateTo);
  }

  if (options?.searchQuery && options.searchQuery.trim()) {
    const q = options.searchQuery.trim();
    const pattern = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    query = query.ilike('subject', pattern);
    // Note: participants search would require RPC; subject-only for MVP
  }

  if (options?.tagIds && options.tagIds.length > 0) {
    const { data: assigned } = await supabase
      .from('thread_tag_assignments')
      .select('thread_id')
      .in('tag_id', options.tagIds);
    const tagThreadIds = [...new Set((assigned ?? []).map((r) => r.thread_id))];
    if (tagThreadIds.length === 0) {
      return [];
    }
    const idsToRestrict = options.restrictToThreadIds
      ? tagThreadIds.filter((id) => options.restrictToThreadIds!.includes(id))
      : tagThreadIds;
    if (idsToRestrict.length === 0) {
      return [];
    }
    query = query.in('id', idsToRestrict);
  }

  if (options?.restrictToThreadIds && options.restrictToThreadIds.length > 0 && !options?.tagIds?.length) {
    query = query.in('id', options.restrictToThreadIds);
  }

  const limit = options?.limit;
  const offset = options?.offset ?? 0;
  if (limit != null && limit > 0) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  const list = (data ?? []) as EmailThread[];

  if (options?.includeUnreadCount === true && list.length > 0) {
    const counts = await getThreadUnreadCounts(list.map((t) => t.id));
    return list.map((t) => ({ ...t, unread_count: counts[t.id] ?? 0 }));
  }

  return list;
}

/**
 * Get unread message count per thread (received messages with read_at IS NULL).
 * Used for inbox thread badges.
 */
export async function getThreadUnreadCounts(
  threadIds: string[]
): Promise<Record<string, number>> {
  if (threadIds.length === 0) {
    return {};
  }
  const { data, error } = await supabase
    .from('email_messages')
    .select('thread_id')
    .in('thread_id', threadIds)
    .eq('direction', 'received')
    .is('read_at', null);

  if (error) {
    throw new Error(`Failed to fetch unread counts: ${error.message}`);
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.thread_id] = (counts[row.thread_id] ?? 0) + 1;
  }
  return counts;
}

const SNIPPET_MAX_LENGTH = 100;

/**
 * Get a truncated preview of the latest message body per thread.
 * Used for thread list cards. Returns threadId -> snippet (stripped, truncated).
 */
export async function getThreadSnippets(
  threadIds: string[]
): Promise<Record<string, string>> {
  if (threadIds.length === 0) {
    return {};
  }
  const { data, error } = await supabase
    .from('email_messages')
    .select('thread_id, body_text, body_html, received_at')
    .in('thread_id', threadIds)
    .order('received_at', { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(`Failed to fetch thread snippets: ${error.message}`);
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.thread_id in map) continue;
    const hasText = row.body_text != null && row.body_text.trim().length > 0;
    const body = hasText ? row.body_text! : (row.body_html ?? '');
    const format = hasText ? 'text' : 'html';
    const display = getDisplayBody(body, { format });
    const oneline = display.replace(/\s+/g, ' ').trim();
    map[row.thread_id] = oneline.slice(0, SNIPPET_MAX_LENGTH);
  }
  return map;
}

/**
 * Mark all received messages in a thread as read.
 * Call when user views/selects a thread.
 */
export async function markThreadMessagesRead(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('email_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .is('read_at', null);

  if (error) {
    throw new Error(`Failed to mark thread as read: ${error.message}`);
  }
}

/**
 * Update thread category (user override).
 */
export async function updateThreadCategory(
  threadId: string,
  category: string | null
): Promise<void> {
  const { error } = await supabase
    .from('email_threads')
    .update({
      category: category ?? null,
      category_source: category ? 'user' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);

  if (error) {
    throw new Error(`Failed to update thread category: ${error.message}`);
  }
}

/**
 * Get a single thread by ID (for current-account checks or detail).
 */
export async function getThreadById(threadId: string): Promise<EmailThread | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch thread: ${error.message}`);
  }

  return data ?? null;
}

/**
 * List messages in a thread, ordered by received_at ascending (chronological).
 */
export async function getMessagesByThread(threadId: string): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return data ?? [];
}

/** Attachment for sending (reply/forward): content is base64 */
export interface SendAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface CreateReplyJobParams {
  accountId: string;
  threadId: string;
  inReplyToMessageId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  toEmail: string;
  toName?: string | null;
  cc?: string[] | null;
  attachments?: SendAttachment[] | null;
}

export interface CreateForwardJobParams {
  accountId: string;
  threadId: string;
  forwardedMessageId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  toEmail: string;
  toName?: string | null;
  cc?: string[] | null;
  attachments?: SendAttachment[] | null;
}

/**
 * Create an inbox reply job. The send-worker will pick it up (manual jobs take priority)
 * and send the reply, then insert email_messages and update email_threads.
 * Returns the new message_job id.
 */
export async function createReplyJob(params: CreateReplyJobParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_inbox_reply_job', {
    p_account_id: params.accountId,
    p_thread_id: params.threadId,
    p_in_reply_to_message_id: params.inReplyToMessageId,
    p_subject: params.subject,
    p_body_text: params.bodyText,
    p_body_html: params.bodyHtml ?? params.bodyText,
    p_to_email: params.toEmail,
    p_to_name: params.toName ?? null,
    p_cc: params.cc && params.cc.length > 0 ? params.cc : null,
    p_attachments: params.attachments ?? null,
  });

  if (error) {
    throw new Error(`Failed to create reply job: ${error.message}`);
  }

  if (data == null || typeof data !== 'string') {
    throw new Error('Failed to create reply job: no job id returned');
  }

  return data;
}

/**
 * Create an inbox forward job. The send-worker will pick it up (manual jobs take priority)
 * and send the forward. Forward is send-only (no email_messages insert).
 * Returns the new message_job id.
 */
export async function createForwardJob(params: CreateForwardJobParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_inbox_forward_job', {
    p_account_id: params.accountId,
    p_thread_id: params.threadId,
    p_forwarded_message_id: params.forwardedMessageId,
    p_subject: params.subject,
    p_body_text: params.bodyText,
    p_body_html: params.bodyHtml ?? params.bodyText,
    p_to_email: params.toEmail,
    p_to_name: params.toName ?? null,
    p_cc: params.cc && params.cc.length > 0 ? params.cc : null,
    p_attachments: params.attachments ?? null,
  });

  if (error) {
    throw new Error(`Failed to create forward job: ${error.message}`);
  }

  if (data == null || typeof data !== 'string') {
    throw new Error('Failed to create forward job: no job id returned');
  }

  return data;
}

export interface MessageJobStatus {
  id: string;
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'blocked';
  error_message: string | null;
}

/**
 * Get message_job status by job ID.
 * Used to check if a reply job has succeeded or failed.
 */
export async function getMessageJobStatus(jobId: string): Promise<MessageJobStatus | null> {
  const { data, error } = await supabase
    .from('message_jobs')
    .select('id, status, error_message')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch message job status: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    status: data.status as MessageJobStatus['status'],
    error_message: data.error_message,
  };
}

export interface PendingInboxReplyJob {
  id: string;
  thread_id: string;
  status: 'pending' | 'reserved' | 'sending' | 'failed';
  error_message: string | null;
  message_data: {
    source: 'inbox_reply';
    thread_id: string;
    in_reply_to_message_id: string;
    subject: string;
    body_text: string;
    body_html: string;
    to_email: string;
    to_name: string;
    cc: string[];
    attachments?: SendAttachment[];
  };
}

/**
 * Get pending/failed inbox reply jobs for threads in an account.
 * Used to restore pending replies after page reload.
 */
export async function getPendingInboxReplyJobs(
  accountId: string
): Promise<PendingInboxReplyJob[]> {
  // First get all thread IDs for this account
  const { data: threads, error: threadsError } = await supabase
    .from('email_threads')
    .select('id')
    .eq('account_id', accountId);

  if (threadsError) {
    throw new Error(`Failed to fetch threads: ${threadsError.message}`);
  }

  if (!threads || threads.length === 0) {
    return [];
  }

  const threadIds = threads.map((t) => t.id);

  // Query message_jobs for inbox_reply jobs that are pending/failed
  const { data: jobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, status, error_message, message_data')
    .eq('message_type', 'inbox_reply')
    .in('status', ['pending', 'reserved', 'sending', 'failed']);

  if (jobsError) {
    throw new Error(`Failed to fetch pending reply jobs: ${jobsError.message}`);
  }

  if (!jobs) {
    return [];
  }

  // Filter to jobs for threads in this account and extract data
  const pendingJobs: PendingInboxReplyJob[] = [];
  for (const job of jobs) {
    const md = job.message_data as any;
    if (md?.source === 'inbox_reply' && threadIds.includes(md.thread_id)) {
      pendingJobs.push({
        id: job.id,
        thread_id: md.thread_id,
        status: job.status as PendingInboxReplyJob['status'],
        error_message: job.error_message,
        message_data: {
          source: 'inbox_reply',
          thread_id: md.thread_id,
          in_reply_to_message_id: md.in_reply_to_message_id,
          subject: md.subject || '',
          body_text: md.body_text || '',
          body_html: md.body_html || md.body_text || '',
          to_email: md.to_email || '',
          to_name: md.to_name || '',
          cc: Array.isArray(md.cc) ? md.cc : [],
          attachments: Array.isArray(md.attachments) ? md.attachments : undefined,
        },
      });
    }
  }

  return pendingJobs;
}

/**
 * Fetch an email attachment from the Lambda Function URL.
 * Returns the raw bytes as a Blob (web) or ArrayBuffer (for React Native).
 *
 * @param functionUrl - Lambda Function URL from amplify_outputs.custom.fetchEmailAttachmentUrl
 * @param authToken - Cognito ID token (from fetchAuthSession)
 * @param emailMessageId - email_messages.id
 * @param part - MIME part identifier (e.g. "1", "1.2")
 */
export async function fetchAttachment(
  functionUrl: string,
  authToken: string,
  emailMessageId: string,
  part: string
): Promise<Blob> {
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ email_message_id: emailMessageId, part }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `Failed to fetch attachment: ${res.status}`);
  }

  return res.blob();
}
