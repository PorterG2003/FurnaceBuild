import { supabase } from '../client';
import type { EmailThread, EmailMessage } from '../types';

/** Attachment metadata stored on email_messages */
export interface AttachmentMeta {
  filename: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  part?: string;
  imapUid?: number;
}

/**
 * List email threads for an account.
 * Ordered by last_message_at descending (newest first).
 * Optionally filter to threads that have at least one reply (has_reply = true).
 */
export async function getThreadsByAccount(
  accountId: string,
  options?: { hasReplyOnly?: boolean; limit?: number }
): Promise<EmailThread[]> {
  let query = supabase
    .from('email_threads')
    .select('*')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false });

  if (options?.hasReplyOnly === true) {
    query = query.eq('has_reply', true);
  }

  if (options?.limit != null && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  return data ?? [];
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
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled';
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
