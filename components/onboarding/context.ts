import { createContext, useContext, type RefObject } from 'react';
import type { View } from 'react-native';
import type { Progress } from '@/lib/onboarding/engine';
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
  /** When true, the current manual step's Next button is disabled. */
  advanceGateBlocked: boolean;
  setAdvanceGateBlocked: (blocked: boolean) => void;
  registerTarget: (id: TargetId, ref: RefObject<View | null>) => () => void;

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
  measureTarget: (id: TargetId) => Promise<TargetRect | null>;
  getTargetNode: (id: TargetId) => unknown | null;
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
