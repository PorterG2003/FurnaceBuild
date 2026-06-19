import { supabase } from '../../client';

export interface MarkEmailThreadOutOfOfficeParams {
  threadId: string;
  outOfOffice: boolean;
  resumeRequested: boolean;
  /** ISO timestamp when enrollment should resume; required if resumeRequested */
  resumeAt?: string | null;
}

export async function markEmailThreadOutOfOffice(params: MarkEmailThreadOutOfOfficeParams): Promise<void> {
  const { error } = await supabase.rpc('mark_email_thread_out_of_office', {
    p_thread_id: params.threadId,
    p_out_of_office: params.outOfOffice,
    p_resume_requested: params.resumeRequested,
    p_resume_at: params.resumeAt ?? null,
  });
  if (error) {
    throw new Error(error.message || 'Failed to update out-of-office');
  }
}

export type ScheduleThreadOooResumeResult =
  | 'scheduled_stopped'
  | 'resumed_stopped'
  | 'resumed_held'
  | 'marked_only'
  | 'no_resumable_execution_state';

export interface SaveEmailThreadOutOfOfficeParams extends MarkEmailThreadOutOfOfficeParams {
  returnDateYmd?: string | null;
  markAutoReply?: boolean;
}

export async function scheduleThreadOooResume(params: {
  threadId: string;
  resumeAt?: string | null;
  returnDateYmd?: string | null;
  markAutoReply?: boolean;
}): Promise<ScheduleThreadOooResumeResult> {
  const { data, error } = await supabase.rpc('schedule_thread_ooo_resume', {
    p_thread_id: params.threadId,
    p_resume_at: params.resumeAt ?? null,
    p_return_date: params.returnDateYmd ?? null,
    p_mark_auto_reply: params.markAutoReply ?? true,
  });

  if (error) {
    throw new Error(error.message || 'Failed to schedule out-of-office resume');
  }

  return (data ?? 'no_resumable_execution_state') as ScheduleThreadOooResumeResult;
}

export async function saveEmailThreadOutOfOffice(
  params: SaveEmailThreadOutOfOfficeParams,
): Promise<ScheduleThreadOooResumeResult> {
  if (!params.outOfOffice) {
    await markEmailThreadOutOfOffice(params);
    return 'marked_only';
  }

  if (params.resumeRequested && !params.resumeAt) {
    throw new Error('resumeAt is required when resumeRequested');
  }

  if (params.markAutoReply || params.resumeRequested) {
    return scheduleThreadOooResume({
      threadId: params.threadId,
      resumeAt: params.resumeRequested ? params.resumeAt : null,
      returnDateYmd: params.returnDateYmd ?? null,
      markAutoReply: params.markAutoReply ?? true,
    });
  }

  await markEmailThreadOutOfOffice(params);
  return 'marked_only';
}
