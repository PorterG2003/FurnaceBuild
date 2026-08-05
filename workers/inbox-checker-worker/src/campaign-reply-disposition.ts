/**
 * Pure policy for what to do with a campaign enrollment after a reply-to-original.
 * Keeps ThreadManager.handleReply thin and unit-testable without DB.
 */

export type CampaignReplyDisposition = 'park_ok' | 'hard_stop' | 'leave_active_alert';

export type ResolveCampaignReplyDispositionInput = {
  isCampaignReply: boolean;
  isUnsubscribe: boolean;
  /** Enrollment already branched (reply_thread_id set). */
  replyThreadIdAlreadySet: boolean;
  hasCategorizer: boolean;
  /** nodes lookup failed — do not treat as "no categorizer". */
  configError: boolean;
  parkStatus: string | null;
  parkError: boolean;
};

/**
 * Decide enrollment action after attempting (or skipping) categorizer park.
 *
 * - Unsubscribe → always hard_stop.
 * - Already branched → never hard_stop (Kristin shape).
 * - Config / park miss on a categorizer (or unknown) campaign → leave_active_alert.
 * - Confirmed non-categorizer campaign → hard_stop (legacy).
 * - Park held|woken|branched → park_ok.
 */
export function resolveCampaignReplyDisposition(
  input: ResolveCampaignReplyDispositionInput,
): CampaignReplyDisposition {
  if (!input.isCampaignReply) {
    return 'hard_stop';
  }
  if (input.isUnsubscribe) {
    return 'hard_stop';
  }
  if (input.replyThreadIdAlreadySet) {
    return 'park_ok';
  }

  const parkSucceeded =
    input.parkStatus === 'held' ||
    input.parkStatus === 'woken' ||
    input.parkStatus === 'branched';
  if (parkSucceeded) {
    return 'park_ok';
  }

  // Known categorizer campaign, or lookup failed (might still be categorizer):
  // never fail open to legacy stop.
  if (input.hasCategorizer || input.configError || input.parkError) {
    return 'leave_active_alert';
  }

  // Park returned ineligible / unexpected while hasCategorizer was true is
  // covered above. Confirmed no categorizer → legacy hard stop.
  if (!input.hasCategorizer && !input.configError) {
    // Attempted park on categorizer path that returned non-success without error
    // (e.g. ineligible) while hasCategorizer true → leave_active. That case is
    // hasCategorizer true above. Here: never attempted or non-categorizer.
    if (input.parkStatus != null) {
      // Park was called and returned something other than success on a
      // non-categorizer? Shouldn't happen; be safe.
      return 'leave_active_alert';
    }
    return 'hard_stop';
  }

  return 'leave_active_alert';
}

/** Whether we should call park_or_advance (vs skipping straight to disposition). */
export function shouldAttemptCategorizerPark(input: {
  isCampaignReply: boolean;
  hasEnrollmentId: boolean;
  isUnsubscribe: boolean;
  hasCategorizer: boolean;
  configError: boolean;
}): boolean {
  return (
    input.isCampaignReply &&
    input.hasEnrollmentId &&
    !input.isUnsubscribe &&
    (input.hasCategorizer || input.configError)
  );
}
