import type { SupabaseClient } from '@supabase/supabase-js';

export const OOO_RESUME_DEFAULT_POLL_MS = 30 * 60 * 1000;
export const OOO_RESUME_MIN_POLL_MS = 60_000;
export const OOO_RESUME_MAX_POLL_MS = 24 * 60 * 60 * 1000;
export const OOO_RESUME_RPC_BATCH_SIZE = 50;

/** Mirrors interval parsing in SchedulerWorker.startOutOfOfficeResumeProcessing. */
export function resolveOooResumePollIntervalMs(envValue: string | undefined): number {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) return OOO_RESUME_DEFAULT_POLL_MS;
  return Math.min(Math.max(Math.floor(parsed), OOO_RESUME_MIN_POLL_MS), OOO_RESUME_MAX_POLL_MS);
}

/**
 * Single scheduler tick: drain due OOO resumes via PostgREST RPC.
 * @returns number of threads processed (0 when none due).
 */
export async function runOutOfOfficeResumeTick(supabase: Pick<SupabaseClient, 'rpc'>): Promise<number> {
  const { data, error } = await supabase.rpc('process_due_out_of_office_resumes', {
    p_batch_size: OOO_RESUME_RPC_BATCH_SIZE,
  });
  if (error) {
    throw error;
  }
  return typeof data === 'number' ? data : 0;
}
