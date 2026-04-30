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
