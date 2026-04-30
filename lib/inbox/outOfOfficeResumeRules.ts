/**
 * Pure helpers mirroring `mark_email_thread_out_of_office`, `process_due_out_of_office_resumes`,
 * and `apply_ooo_resume_core` in `supabase/migrations/20260429143000_out_of_office_email_threads.sql`.
 * Keep in sync when changing those functions.
 */

/** Enrollment must be stopped for reply and not soft-deleted to schedule or apply OOO resume. */
export function enrollmentQualifiesForOooResume(input: {
  state: string | null | undefined;
  stoppedReason: string | null | undefined;
  deletedAt: string | null | undefined;
}): boolean {
  if (input.deletedAt != null) return false;
  return input.state === 'stopped' && input.stoppedReason === 'replied';
}

/**
 * Row matches the due-thread predicate used by `process_due_out_of_office_resumes`
 * (time check only; DB also uses `ooo_resume_at <= NOW()`).
 */
export function threadRowIsDueForOooResumeProcessing(input: {
  oooResumeRequested: boolean;
  outOfOffice: boolean;
  oooResumeProcessedAt: string | null | undefined;
  enrollmentId: string | null | undefined;
  oooResumeAt: string | null | undefined;
  now: Date;
}): boolean {
  if (!input.oooResumeRequested) return false;
  if (!input.outOfOffice) return false;
  if (input.oooResumeProcessedAt != null) return false;
  if (input.enrollmentId == null || input.enrollmentId === '') return false;
  if (input.oooResumeAt == null || input.oooResumeAt === '') return false;
  return new Date(input.oooResumeAt).getTime() <= input.now.getTime();
}

/**
 * Pending campaign job `scheduled_at` after OOO resume core runs:
 * `GREATEST(mj.scheduled_at, v_floor + interval '30 seconds')` where `v_floor` is already
 * `GREATEST(p_not_before, NOW())` from SQL.
 */
export function nextCampaignJobScheduledAtAfterOooResume(input: {
  jobScheduledAt: Date;
  /** Same instant SQL uses as `v_floor` before adding 30 seconds. */
  resumeNotBefore: Date;
}): Date {
  const floorPlusSlack = new Date(input.resumeNotBefore.getTime() + 30_000);
  return input.jobScheduledAt > floorPlusSlack ? input.jobScheduledAt : floorPlusSlack;
}
