import type { FlowId, OnboardingFlowDef } from './types';

export interface StartFlowConditions {
  /** The provider is enabled (main shell interactive). */
  enabled: boolean;
  /** Per-user seen-state has loaded. */
  stateLoaded: boolean;
  hasUser: boolean;
  /** A flow is registered for this id. */
  flowExists: boolean;
  /** The user has already seen (completed/dismissed/aborted) this flow. */
  alreadySeen: boolean;
  /** Engine is idle with no pending ended metadata awaiting persistence. */
  engineIdle: boolean;
  /** A modal/sheet is open that the onboarding overlay must not fight. */
  blockingOverlayPresent: boolean;
}

/**
 * Pure guard for starting a flow via the scheduler. Returns true only when a
 * flow may begin its (delayed) start.
 */
export function canStartFlow(c: StartFlowConditions): boolean {
  return (
    c.enabled &&
    c.stateLoaded &&
    c.hasUser &&
    c.flowExists &&
    !c.alreadySeen &&
    c.engineIdle &&
    !c.blockingOverlayPresent
  );
}

export interface PickNextFlowInput {
  flows: OnboardingFlowDef[];
  seen: ReadonlySet<string>;
  /** Flow ids registered ready by mounted screens. */
  readyRegistrations: ReadonlySet<FlowId>;
}

/**
 * Deterministic priority: iterate registry order and return the first unseen
 * flow that is autoStart-eligible or registered ready by a mounted screen.
 */
export function pickNextFlow(input: PickNextFlowInput): FlowId | null {
  for (const def of input.flows) {
    if (input.seen.has(def.id)) continue;
    if (def.autoStart || input.readyRegistrations.has(def.id)) {
      return def.id;
    }
  }
  return null;
}
