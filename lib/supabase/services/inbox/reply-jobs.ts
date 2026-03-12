import { supabase } from '../../client';
import type { SendAttachment } from './messages';

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

export interface MessageJobStatus {
  id: string;
  status: 'pending' | 'reserved' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'blocked';
  error_message: string | null;
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
  if (error) throw new Error(`Failed to create reply job: ${error.message}`);
  if (data == null || typeof data !== 'string') throw new Error('Failed to create reply job: no job id returned');
  return data;
}

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
  if (error) throw new Error(`Failed to create forward job: ${error.message}`);
  if (data == null || typeof data !== 'string') throw new Error('Failed to create forward job: no job id returned');
  return data;
}

export async function getMessageJobStatus(jobId: string): Promise<MessageJobStatus | null> {
  const { data, error } = await supabase
    .from('message_jobs')
    .select('id, status, error_message')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch message job status: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status as MessageJobStatus['status'],
    error_message: data.error_message,
  };
}

export async function getPendingInboxReplyJobs(
  accountId: string
): Promise<PendingInboxReplyJob[]> {
  const { data: threads, error: threadsError } = await supabase
    .from('email_threads')
    .select('id')
    .eq('account_id', accountId);
  if (threadsError) throw new Error(`Failed to fetch threads: ${threadsError.message}`);
  if (!threads?.length) return [];

  const threadIds = threads.map((t) => t.id);
  const { data: jobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, status, error_message, message_data')
    .eq('message_type', 'inbox_reply')
    .in('status', ['pending', 'reserved', 'sending', 'failed']);
  if (jobsError) throw new Error(`Failed to fetch pending reply jobs: ${jobsError.message}`);
  if (!jobs) return [];

  const pendingJobs: PendingInboxReplyJob[] = [];
  for (const job of jobs) {
    const md = job.message_data as Record<string, unknown>;
    if (md?.source === 'inbox_reply' && typeof md.thread_id === 'string' && threadIds.includes(md.thread_id)) {
      pendingJobs.push({
        id: job.id,
        thread_id: md.thread_id,
        status: job.status as PendingInboxReplyJob['status'],
        error_message: job.error_message,
        message_data: {
          source: 'inbox_reply',
          thread_id: md.thread_id,
          in_reply_to_message_id: (md.in_reply_to_message_id as string) ?? '',
          subject: (md.subject as string) ?? '',
          body_text: (md.body_text as string) ?? '',
          body_html: (md.body_html as string) ?? (md.body_text as string) ?? '',
          to_email: (md.to_email as string) ?? '',
          to_name: (md.to_name as string) ?? '',
          cc: Array.isArray(md.cc) ? md.cc : [],
          attachments: Array.isArray(md.attachments) ? md.attachments as SendAttachment[] : undefined,
        },
      });
    }
  }
  return pendingJobs;
}
