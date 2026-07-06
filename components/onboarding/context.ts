import { createContext, useContext, type RefObject } from 'react';
import type { View } from 'react-native';
import type { InboxThreadToolbarActionKey } from '@/lib/inbox';
import type { Progress } from '@/lib/onboarding/engine';
import type { OnboardingHostId } from '@/lib/onboarding/onboardingHosts';
import type { TargetSurface } from '@/lib/onboarding/targetRegistry';
import type { FlowId, OnboardingStep, Segment, TargetId } from '@/lib/onboarding/types';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OnboardingContextValue {
  // Public API
  startFlow: (id: FlowId) => void;
  /**
   * Screen-owned trigger entrypoint: registers whether a flow is ready to start.
   * The provider scheduler picks the first unseen eligible flow when idle.
   */
  registerFlowIntent: (id: FlowId, ready: boolean) => void;
  /** True once persisted seen-state has loaded for the current user. */
  seenStateLoaded: boolean;
  /** Read whether a flow has already been seen for the current user. */
  hasSeenFlow: (id: FlowId) => boolean;
  dismissFlow: () => void;
  /** Clears persisted state for a flow so it can run again ("Replay tour"). */
  resetFlow: (id: FlowId) => Promise<void>;
  /** Clears persisted state for every seen flow (e.g. a "Replay tours" action). */
  resetAllFlows: () => Promise<void>;
  next: () => void;
  back: () => void;
  notifyTargetPress: (id: TargetId) => void;
  /** Advances the current step when its `advance` mode is `onRequirementMet`. */
  notifyStepRequirementMet: () => void;
  /** When true, the current manual step's Next button is blocked by app state. */
  currentStepNextBlocked: boolean;
  setCurrentStepNextBlocked: (blocked: boolean) => void;
  /** `surface` scopes the ref so the same TargetId can coexist on the global
   * viewport and inside a modal host without one registration overwriting the
   * other. Defaults to `'global'`. */
  registerTarget: (id: TargetId, ref: RefObject<View | null>, surface?: TargetSurface) => () => void;
  /**
   * The inbox thread toolbar reports which actions are currently collapsed into
   * the "More actions" overflow menu (ordered), or null when no toolbar is
   * mounted. Read at flow start so the inbox action tours can resolve
   * inline-vs-in-menu steps up front instead of skipping at render time.
   */
  setInboxToolbarOverflow: (keys: readonly InboxThreadToolbarActionKey[] | null) => void;
  /** True once the inbox toolbar has reported an overflow split for this thread. */
  inboxToolbarOverflowReported: boolean;

  // State for the overlay
  currentStep: OnboardingStep | null;
  progress: Progress | null;
  reducedMotion: boolean;
  blockingOverlayPresent: boolean;
  /** Audience segment, for segment-aware announcement art (e.g. the welcome hero). */
  segment: Segment;
  /**
   * True when the active flow cannot be skipped/dismissed by the user (a
   * `mandatory` flow whose `mandatoryUnlessSeen` sibling has not been seen). The
   * overlays hide the Skip link and block backdrop/hardware-back dismissal.
   */
  currentFlowMandatory: boolean;

  // Internal helpers used by the overlay primitives
  skipStep: () => void;
  /** Ends the active flow because a step's target never appeared. */
  abortFlow: () => void;
  /** `surface` defaults to the active step's `hostId` (or `'global'`) so
   * callers measuring the current step's own target never need to pass it. */
  measureTarget: (id: TargetId, surface?: TargetSurface) => Promise<TargetRect | null>;
  getTargetNode: (id: TargetId, surface?: TargetSurface) => unknown | null;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return ctx;
}

/** Returns null outside a provider — safe for shared components to adopt. */
export function useOnboardingOptional(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}

/**
 * Shared selector: true when the active onboarding step declares `hostId`.
 * Single source of truth for both the `OnboardingHost` render gate and the
 * screen-level lifecycle (pin + non-blocking) wiring, so the "current step
 * belongs to this host" check is never duplicated or drifts.
 */
export function useOnboardingHostActive(hostId: OnboardingHostId): boolean {
  const ctx = useOnboardingOptional();
  const step = ctx?.currentStep;
  if (!step || step.kind !== 'spotlight') return false;
  return step.hostId === hostId;
}
