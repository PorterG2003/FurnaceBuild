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
  status: 'queued' | 'reserved' | 'sending' | 'sent' | 'deferred' | 'failed' | 'cancelled' | 'blocked';
  error_message: string | null;
  scheduled_at: string | null;
  send_wait_reason: string | null;
  throttle_bypass_next_attempt: boolean;
}

export interface ThreadAutoReplyPipelineState {
  active: boolean;
  phase: 'categorizing' | 'arming_reply' | null;
  label: string | null;
}

export type PendingInboxManualSource = 'inbox_reply' | 'inbox_forward';

export type PendingCampaignReplySource = 'campaign_reply';

export interface PendingInboxManualJob {
  id: string;
  thread_id: string;
  created_at: string;
  status: 'queued' | 'reserved' | 'sending' | 'failed';
  error_message: string | null;
  scheduled_at: string | null;
  send_wait_reason: string | null;
  throttle_bypass_next_attempt: boolean;
  message_data: {
    source: PendingInboxManualSource;
    thread_id: string;
    in_reply_to_message_id?: string;
    forwarded_message_id?: string;
    subject: string;
    body_text: string;
    body_html: string;
    to_email: string;
    to_name: string;
    cc: string[];
    attachments?: SendAttachment[];
  };
}

export interface PendingCampaignReplyJob {
  id: string;
  thread_id: string;
  campaign_id: string;
  mailbox_id: string;
  node_id: string | null;
  created_at: string;
  status: 'queued' | 'reserved' | 'sending' | 'failed';
  error_message: string | null;
  scheduled_at: string | null;
  send_wait_reason: string | null;
  throttle_bypass_next_attempt: boolean;
  message_data: {
    source: PendingCampaignReplySource;
    thread_id: string;
    subject: string;
    to_email: string;
    to_name: string;
    in_reply_to?: string;
    message_references?: string;
    lead_data?: Record<string, unknown>;
    node_config?: Record<string, unknown>;
    body_text?: string;
    body_html?: string;
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
    .select('id, status, error_message, scheduled_at, send_wait_reason, throttle_bypass_next_attempt')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch message job status: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status as MessageJobStatus['status'],
    error_message: data.error_message,
    scheduled_at: data.scheduled_at,
    send_wait_reason: data.send_wait_reason,
    throttle_bypass_next_attempt: data.throttle_bypass_next_attempt ?? false,
  };
}

export async function requestImmediateManualSend(jobId: string): Promise<void> {
  const { data, error } = await supabase.rpc('request_immediate_manual_send', {
    p_message_job_id: jobId,
  });
  if (error) throw new Error(`Failed to send immediately: ${error.message}`);
  if (data !== true) throw new Error('Failed to send immediately');
}

export async function cancelPendingOutboundJob(jobId: string): Promise<void> {
  const { data, error } = await supabase.rpc('cancel_pending_outbound_job', {
    p_message_job_id: jobId,
  });
  if (error) throw new Error(`Failed to cancel pending outbound job: ${error.message}`);
  if (data !== true) throw new Error('Failed to cancel pending outbound job');
}

export async function getThreadAutoReplyPipelineState(
  threadId: string
): Promise<ThreadAutoReplyPipelineState | null> {
  const { data, error } = await supabase
    .rpc('get_thread_auto_reply_pipeline_state', {
      p_thread_id: threadId,
    })
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch auto-reply pipeline state: ${error.message}`);
  if (!data || data.active !== true) return null;
  return {
    active: true,
    phase:
      data.phase === 'categorizing' || data.phase === 'arming_reply'
        ? data.phase
        : null,
    label: typeof data.label === 'string' ? data.label : null,
  };
}

export async function getPendingInboxManualJobs(
  accountId: string
): Promise<PendingInboxManualJob[]> {
  const { data: jobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, status, error_message, scheduled_at, send_wait_reason, throttle_bypass_next_attempt, message_data, created_at')
    .eq('account_id', accountId)
    .in('message_type', ['inbox_reply', 'inbox_forward'])
    .in('status', ['queued', 'reserved', 'sending', 'failed']);
  if (jobsError) throw new Error(`Failed to fetch pending manual jobs: ${jobsError.message}`);
  if (!jobs) return [];

  const pendingJobs: PendingInboxManualJob[] = [];
  for (const job of jobs) {
    const md = job.message_data as Record<string, unknown>;
    const source = md?.source;
    if (
      (source === 'inbox_reply' || source === 'inbox_forward') &&
      typeof md.thread_id === 'string'
    ) {
      pendingJobs.push({
        id: job.id,
        thread_id: md.thread_id,
        created_at: job.created_at as string,
        status: job.status as PendingInboxManualJob['status'],
        error_message: job.error_message,
        scheduled_at: job.scheduled_at as string | null,
        send_wait_reason: job.send_wait_reason as string | null,
        throttle_bypass_next_attempt: job.throttle_bypass_next_attempt ?? false,
        message_data: {
          source,
          thread_id: md.thread_id,
          in_reply_to_message_id: (md.in_reply_to_message_id as string) ?? undefined,
          forwarded_message_id: (md.forwarded_message_id as string) ?? undefined,
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
  pendingJobs.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return pendingJobs;
}

export async function getPendingCampaignReplyJobs(
  accountId: string
): Promise<PendingCampaignReplyJob[]> {
  const { data: jobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, campaign_id, mailbox_id, node_id, status, error_message, scheduled_at, send_wait_reason, throttle_bypass_next_attempt, message_data, created_at')
    .eq('account_id', accountId)
    .eq('message_type', 'campaign_reply')
    .in('status', ['queued', 'reserved', 'sending', 'failed']);
  if (jobsError) throw new Error(`Failed to fetch pending campaign reply jobs: ${jobsError.message}`);
  if (!jobs) return [];

  const pendingJobs: PendingCampaignReplyJob[] = [];
  for (const job of jobs) {
    const md = job.message_data as Record<string, unknown>;
    if (md?.source !== 'campaign_reply' || typeof md.thread_id !== 'string') continue;

    pendingJobs.push({
      id: job.id,
      thread_id: md.thread_id,
      campaign_id: job.campaign_id as string,
      mailbox_id: job.mailbox_id as string,
      node_id: (job.node_id as string | null) ?? null,
      created_at: job.created_at as string,
      status: job.status as PendingCampaignReplyJob['status'],
      error_message: job.error_message,
      scheduled_at: job.scheduled_at as string | null,
      send_wait_reason: job.send_wait_reason as string | null,
      throttle_bypass_next_attempt: job.throttle_bypass_next_attempt ?? false,
      message_data: {
        source: 'campaign_reply',
        thread_id: md.thread_id,
        subject: (md.subject as string) ?? '',
        to_email: (md.to_email as string) ?? '',
        to_name: (md.to_name as string) ?? '',
        in_reply_to: (md.in_reply_to as string) ?? undefined,
        message_references: (md.message_references as string) ?? undefined,
        body_text: (md.body_text as string) ?? undefined,
        body_html: (md.body_html as string) ?? undefined,
        lead_data:
          md.lead_data && typeof md.lead_data === 'object'
            ? (md.lead_data as Record<string, unknown>)
            : undefined,
        node_config:
          md.node_config && typeof md.node_config === 'object'
            ? (md.node_config as Record<string, unknown>)
            : undefined,
      },
    });
  }

  pendingJobs.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return pendingJobs;
}

export interface PendingInboxReplyJob extends PendingInboxManualJob {
  message_data: PendingInboxManualJob['message_data'] & {
    source: 'inbox_reply';
    in_reply_to_message_id: string;
  };
}

export async function getPendingInboxReplyJobs(
  accountId: string
): Promise<PendingInboxReplyJob[]> {
  const jobs = await getPendingInboxManualJobs(accountId);
  return jobs.filter(
    (job): job is PendingInboxReplyJob =>
      job.message_data.source === 'inbox_reply' && typeof job.message_data.in_reply_to_message_id === 'string'
  );
}
