export interface RequestFlowConditions {
  /** The provider is enabled (main shell interactive). */
  enabled: boolean;
  /** Per-user seen-state has loaded. */
  stateLoaded: boolean;
  hasUser: boolean;
  /** A flow is registered for this id. */
  flowExists: boolean;
  /** The user has already seen (completed/dismissed/aborted) this flow. */
  alreadySeen: boolean;
  /** Another flow is currently active. */
  flowActive: boolean;
  /** Another flow is scheduled to start (within the settle delay). */
  flowPending: boolean;
  /** A modal/sheet is open that the onboarding overlay must not fight. */
  blockingOverlayPresent: boolean;
}

/**
 * Pure guard for `requestFlow`. Returns true only when a flow may begin its
 * (delayed) start. `flowActive`/`flowPending` together form the single-flight
 * lock: at most one flow can be active OR pending at any time.
 */
export function canRequestFlow(c: RequestFlowConditions): boolean {
  return (
    c.enabled &&
    c.stateLoaded &&
    c.hasUser &&
    c.flowExists &&
    !c.alreadySeen &&
    !c.flowActive &&
    !c.flowPending &&
    !c.blockingOverlayPresent
  );
}
