import type { InboxSupabase } from './threads.js';

export interface PublicMessageJob {
  id: string;
  status: string;
  message_type: string | null;
  thread_id: string | null;
  error_message: string | null;
  scheduled_at: string | null;
  send_wait_reason: string | null;
  status_reason: string | null;
}

type MessageJobRow = {
  id: string;
  account_id: string;
  status: string;
  message_type: string | null;
  error_message: string | null;
  scheduled_at?: string | null;
  send_wait_reason?: string | null;
  status_reason?: string | null;
  message_data?: unknown;
};

function threadIdFromMessageData(messageData: unknown): string | null {
  if (!messageData || typeof messageData !== 'object' || Array.isArray(messageData)) {
    return null;
  }
  const threadId = (messageData as Record<string, unknown>).thread_id;
  return typeof threadId === 'string' ? threadId : null;
}

export function toPublicMessageJob(row: MessageJobRow): PublicMessageJob {
  return {
    id: row.id,
    status: row.status,
    message_type: row.message_type,
    thread_id: threadIdFromMessageData(row.message_data),
    error_message: row.error_message,
    scheduled_at: row.scheduled_at ?? null,
    send_wait_reason: row.send_wait_reason ?? null,
    status_reason: row.status_reason ?? null,
  };
}

export async function loadAccountMessageJobOrThrow(
  supabase: InboxSupabase,
  accountId: string,
  jobId: string,
): Promise<MessageJobRow | null> {
  const { data, error } = await supabase
    .from('message_jobs')
    .select('id, account_id, status, message_type, error_message, scheduled_at, send_wait_reason, status_reason, message_data')
    .eq('id', jobId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch message job: ${error.message}`);
  }
  return data as MessageJobRow | null;
}

export async function loadThreadMessageOrThrow(
  supabase: InboxSupabase,
  threadId: string,
  messageId: string,
) {
  const { data, error } = await supabase
    .from('email_messages')
    .select('id, subject, from_email, from_name, to_email, thread_id')
    .eq('id', messageId)
    .eq('thread_id', threadId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch message: ${error.message}`);
  }
  return data;
}

export async function loadLatestThreadMessage(
  supabase: InboxSupabase,
  threadId: string,
) {
  const { data, error } = await supabase
    .from('email_messages')
    .select('id, subject, from_email, from_name, to_email')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch latest thread message: ${error.message}`);
  }
  return data;
}

export type OutboundComposerBody = {
  subject?: string;
  body_text?: string;
  body_html?: string;
  to_email?: string;
  to_name?: string;
  cc?: string[];
};

export async function createInboxReplyJob(
  supabase: InboxSupabase,
  params: {
    accountId: string;
    threadId: string;
    inReplyToMessageId: string;
    body: OutboundComposerBody;
    targetMessage: {
      subject: string | null;
      from_email: string | null;
      from_name: string | null;
      to_email: string | null;
    };
  },
): Promise<string> {
  const { data, error } = await supabase.rpc('create_inbox_reply_job', {
    p_account_id: params.accountId,
    p_thread_id: params.threadId,
    p_in_reply_to_message_id: params.inReplyToMessageId,
    p_subject: params.body.subject?.trim() || params.targetMessage.subject || 'Re:',
    p_body_text: params.body.body_text?.trim() || '',
    p_body_html: params.body.body_html?.trim() || params.body.body_text?.trim() || '',
    p_to_email: params.body.to_email?.trim() || params.targetMessage.from_email || params.targetMessage.to_email || '',
    p_to_name: params.body.to_name?.trim() || params.targetMessage.from_name || null,
    p_cc: Array.isArray(params.body.cc) && params.body.cc.length > 0 ? params.body.cc : null,
  });
  if (error) {
    throw new Error(`Failed to create reply job: ${error.message}`);
  }
  if (typeof data !== 'string') {
    throw new Error('Failed to create reply job: no job id returned');
  }
  return data;
}

export async function createInboxForwardJob(
  supabase: InboxSupabase,
  params: {
    accountId: string;
    threadId: string;
    forwardedMessageId: string;
    body: OutboundComposerBody;
    forwardedMessage: {
      subject: string | null;
    };
  },
): Promise<string> {
  const { data, error } = await supabase.rpc('create_inbox_forward_job', {
    p_account_id: params.accountId,
    p_thread_id: params.threadId,
    p_forwarded_message_id: params.forwardedMessageId,
    p_subject: params.body.subject?.trim() || forwardedSubject(params.forwardedMessage.subject),
    p_body_text: params.body.body_text?.trim() || '',
    p_body_html: params.body.body_html?.trim() || params.body.body_text?.trim() || '',
    p_to_email: params.body.to_email?.trim() || '',
    p_to_name: params.body.to_name?.trim() || null,
    p_cc: Array.isArray(params.body.cc) && params.body.cc.length > 0 ? params.body.cc : null,
  });
  if (error) {
    throw new Error(`Failed to create forward job: ${error.message}`);
  }
  if (typeof data !== 'string') {
    throw new Error('Failed to create forward job: no job id returned');
  }
  return data;
}

function forwardedSubject(subject: string | null): string {
  const trimmed = subject?.trim();
  if (!trimmed) return 'Fwd:';
  return trimmed.toLowerCase().startsWith('fwd:') ? trimmed : `Fwd: ${trimmed}`;
}

export async function cancelAccountMessageJob(
  supabase: InboxSupabase,
  job: MessageJobRow,
): Promise<void> {
  if (
    !job.message_type ||
    !['inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority'].includes(job.message_type)
  ) {
    throw new Error('Only reply-lane jobs can be cancelled from the inbox');
  }
  if (!['queued', 'reserved', 'failed'].includes(job.status)) {
    throw new Error('Only queued, reserved, or failed jobs can be cancelled');
  }

  const { data: fullJob, error: loadError } = await supabase
    .from('message_jobs')
    .select('id, message_type, enrollment_id')
    .eq('id', job.id)
    .maybeSingle();
  if (loadError) {
    throw new Error(`Failed to load message job for cancel: ${loadError.message}`);
  }
  if (!fullJob) {
    throw new Error('Message job not found');
  }

  const { error } = await supabase
    .from('message_jobs')
    .update({
      status: 'cancelled',
      status_reason:
        fullJob.message_type === 'campaign_reply' || fullJob.message_type === 'campaign_priority'
          ? 'inbox_manual_override'
          : 'inbox_user_cancelled',
      error_message: 'Cancelled from inbox',
      reserved_at: null,
      lease_expires_at: null,
      claim_token: null,
      sending_started_at: null,
      send_wait_reason: null,
      throttle_bypass_next_attempt: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  if (error) {
    throw new Error(`Failed to cancel message job: ${error.message}`);
  }

  if (
    (fullJob.message_type === 'campaign_reply' || fullJob.message_type === 'campaign_priority') &&
    fullJob.enrollment_id
  ) {
    await supabase
      .from('enrollments')
      .update({
        next_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', fullJob.enrollment_id)
      .eq('state', 'active')
      .is('deleted_at', null);
  }
}

export async function sendAccountMessageJobNow(
  supabase: InboxSupabase,
  job: MessageJobRow,
): Promise<void> {
  if (
    !job.message_type ||
    !['inbox_reply', 'inbox_forward', 'campaign_reply', 'campaign_priority'].includes(job.message_type)
  ) {
    throw new Error('Only reply-lane jobs can be sent immediately');
  }
  if (job.status !== 'queued') {
    throw new Error('Only queued jobs can be sent immediately');
  }

  const { error } = await supabase
    .from('message_jobs')
    .update({
      scheduled_at: new Date().toISOString(),
      send_wait_reason: null,
      throttle_bypass_next_attempt: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  if (error) {
    throw new Error(`Failed to send message job immediately: ${error.message}`);
  }
}

export async function saveThreadOutOfOffice(
  supabase: InboxSupabase,
  threadId: string,
  input: {
    resumeAt?: string | null;
    resumeMode: 'scheduled' | 'instant' | 'none';
  },
): Promise<string> {
  if (input.resumeMode === 'scheduled') {
    if (!input.resumeAt?.trim()) {
      throw new Error('resume_at is required when resume_mode is scheduled');
    }
    const { data, error } = await supabase.rpc('schedule_thread_ooo_resume', {
      p_thread_id: threadId,
      p_resume_at: input.resumeAt,
      p_return_date: null,
      p_mark_auto_reply: true,
    });
    if (error) {
      throw new Error(error.message || 'Failed to schedule out-of-office resume');
    }
    return (data ?? 'marked_only') as string;
  }

  if (input.resumeMode === 'instant') {
    const { data, error } = await supabase.rpc('schedule_thread_ooo_resume', {
      p_thread_id: threadId,
      p_resume_at: new Date().toISOString(),
      p_return_date: null,
      p_mark_auto_reply: true,
    });
    if (error) {
      throw new Error(error.message || 'Failed to schedule instant out-of-office resume');
    }
    return (data ?? 'marked_only') as string;
  }

  const { error } = await supabase.rpc('mark_email_thread_out_of_office', {
    p_thread_id: threadId,
    p_out_of_office: true,
    p_resume_requested: false,
    p_resume_at: null,
  });
  if (error) {
    throw new Error(error.message || 'Failed to mark out-of-office');
  }
  return 'marked_only';
}

export async function clearThreadOutOfOffice(
  supabase: InboxSupabase,
  threadId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mark_email_thread_out_of_office', {
    p_thread_id: threadId,
    p_out_of_office: false,
    p_resume_requested: false,
    p_resume_at: null,
  });
  if (error) {
    throw new Error(error.message || 'Failed to clear out-of-office');
  }
}
