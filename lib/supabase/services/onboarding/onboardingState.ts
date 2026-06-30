import { supabase } from '../../client';
import type { UserOnboardingState } from '@/lib/supabase/types';

/**
 * Data access for per-user onboarding/announcement flow state.
 *
 * Writes are intentionally fail-soft: a failed completion write must never
 * block the UI (covers e.g. the public.users provisioning race right after
 * signup). Callers fire-and-forget; we log and swallow errors.
 */

export type OnboardingStatus = 'completed' | 'dismissed' | 'aborted';

export async function fetchOnboardingState(
  userId: string,
): Promise<UserOnboardingState[]> {
  const { data, error } = await supabase
    .from('user_onboarding_state')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.warn('[onboarding] failed to fetch state', error.message);
    return [];
  }
  return data ?? [];
}

async function writeStatus(
  userId: string,
  flowId: string,
  flowVersion: number,
  status: OnboardingStatus,
): Promise<void> {
  const { error } = await supabase.from('user_onboarding_state').upsert(
    {
      user_id: userId,
      flow_id: flowId,
      flow_version: flowVersion,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,flow_id' },
  );

  if (error) {
    // Fail-soft: never throw into the UI.
    console.warn(`[onboarding] failed to mark ${flowId} ${status}`, error.message);
  }
}

export function markFlowComplete(
  userId: string,
  flowId: string,
  flowVersion: number,
): Promise<void> {
  return writeStatus(userId, flowId, flowVersion, 'completed');
}

export function markFlowDismissed(
  userId: string,
  flowId: string,
  flowVersion: number,
): Promise<void> {
  return writeStatus(userId, flowId, flowVersion, 'dismissed');
}

/**
 * Marks a flow `aborted` — it ended because a step's target never appeared, not
 * because the user finished or skipped it. Persisted (rather than retried
 * forever) to avoid an every-visit loop on a permanently-missing anchor; stays
 * distinct from completed/dismissed so broken anchors are visible.
 */
export function markFlowAborted(
  userId: string,
  flowId: string,
  flowVersion: number,
): Promise<void> {
  return writeStatus(userId, flowId, flowVersion, 'aborted');
}

/**
 * Clears a user's stored state for a flow so it can run again. Exposed as the
 * seam behind a future "Replay tour" affordance; smoke testing can also do this
 * directly in SQL.
 */
export async function resetFlowState(userId: string, flowId: string): Promise<void> {
  const { error } = await supabase
    .from('user_onboarding_state')
    .delete()
    .eq('user_id', userId)
    .eq('flow_id', flowId);

  if (error) {
    console.warn(`[onboarding] failed to reset ${flowId}`, error.message);
  }
}
