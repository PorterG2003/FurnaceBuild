import type { ReactNode } from 'react';

/**
 * Single source of truth for spotlight anchor ids. Components opt in via
 * `useOnboardingTarget(TARGETS.x)`, and steps reference the same id, so a typo
 * or a removed target becomes a compile error rather than a "highlights
 * nothing" bug at runtime.
 */
export const TARGETS = {
  demoNav: 'demoNav',
  demoSettings: 'demoSettings',
  demoAccount: 'demoAccount',
} as const;

export type TargetId = (typeof TARGETS)[keyof typeof TARGETS];

/** Typed flow ids — these strings also persist to user_onboarding_state.flow_id. */
export type FlowId = 'scaffold-demo';

export type SpotlightPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * How a spotlight step advances:
 * - 'manual': the user clicks Next in the callout.
 * - 'onTargetPress': the step completes when the user presses the highlighted
 *   element itself (the cutout stays interactive).
 */
export type StepAdvance = 'manual' | 'onTargetPress';

export interface SpotlightStep {
  kind: 'spotlight';
  targetId: TargetId;
  /** Optional route the target lives on; the provider navigates here first. */
  route?: string;
  title: string;
  body: string;
  placement?: SpotlightPlacement;
  advance?: StepAdvance;
}

export interface AnnouncementStep {
  kind: 'announcement';
  route?: string;
  title?: string;
  description?: string;
  /** Demo/illustration node. Lazy-import heavy content here. */
  render: () => ReactNode;
  maxWidth?: '4xl' | '5xl' | '6xl';
}

export type OnboardingStep = SpotlightStep | AnnouncementStep;

export interface OnboardingFlow {
  id: FlowId;
  version: number;
  /** When true, the provider starts this flow automatically if unseen. */
  autoStart?: boolean;
  steps: OnboardingStep[];
}
