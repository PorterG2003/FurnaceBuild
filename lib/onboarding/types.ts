import type { ReactNode } from 'react';

/**
 * Single source of truth for spotlight anchor ids. Components opt in via
 * `useOnboardingTarget(TARGETS.x)`, and steps reference the same id, so a typo
 * or a removed target becomes a compile error rather than a "highlights
 * nothing" bug at runtime.
 *
 * These are the *planned* anchors for the real flows. Defining the ids is
 * type-only and harmless; screens adopt them incrementally by spreading the
 * ref returned from `useOnboardingTarget`.
 */
export const TARGETS = {
  navItems: 'navItems',
  inboxThreadList: 'inboxThreadList',
  inboxCategories: 'inboxCategories',
  metricsRange: 'metricsRange',
  leadsImport: 'leadsImport',
  leadsExport: 'leadsExport',
  sendersConnect: 'sendersConnect',
  campaignsCreate: 'campaignsCreate',
  builderCanvas: 'builderCanvas',
  missionControlChecklist: 'missionControlChecklist',
  accountTeam: 'accountTeam',
  accountIntegrations: 'accountIntegrations',
  notificationsBell: 'notificationsBell',
} as const;

export type TargetId = (typeof TARGETS)[keyof typeof TARGETS];

/**
 * Typed flow ids — the union of *planned* flows. These strings also persist to
 * user_onboarding_state.flow_id. Listing them here is type-level scaffolding;
 * the registry does not need to implement any of them (see `flows/index.ts`).
 */
export type FlowId =
  | 'welcome'
  | 'inbox'
  | 'metrics'
  | 'leads'
  | 'notifications'
  | 'account'
  | 'senders'
  | 'campaigns'
  | 'builder'
  | 'mission-control';

/** Audience segment. Drives copy/framing only — never which flows exist. */
export type Segment = 'self_serve' | 'dfy';

/** Account membership role, used for step-level gating in a flow. */
export type Role = 'owner' | 'admin' | 'member';

/**
 * Authoring-time copy that can vary by segment. Record-based so adding a future
 * segment never reshapes the type or existing call sites: `resolveCopy` returns
 * `copy[segment] ?? copy.default`.
 */
export type SegmentCopy = string | (Partial<Record<Segment, string>> & { default: string });

export type SpotlightPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * How a spotlight step advances:
 * - 'manual': the user clicks Next in the callout.
 * - 'onTargetPress': the step completes when the user presses the highlighted
 *   element itself (the cutout stays interactive).
 */
export type StepAdvance = 'manual' | 'onTargetPress';

// ---------------------------------------------------------------------------
// Authoring types ("defs"): what flow authors write. Copy may be segment-aware,
// steps may declare `requiresRole`. These are converted to the resolved types
// below by `resolveFlow` before the engine ever sees them.
// ---------------------------------------------------------------------------

export interface SpotlightStepDef {
  kind: 'spotlight';
  targetId: TargetId;
  /** Optional route the target lives on; the provider navigates here first. */
  route?: string;
  title: SegmentCopy;
  body: SegmentCopy;
  placement?: SpotlightPlacement;
  advance?: StepAdvance;
  /** When set, the step only renders for these roles (others are filtered out). */
  requiresRole?: Role[];
}

export interface AnnouncementStepDef {
  kind: 'announcement';
  route?: string;
  title?: SegmentCopy;
  description?: SegmentCopy;
  /** Demo/illustration node. Lazy-import heavy content here. */
  render: () => ReactNode;
  maxWidth?: '4xl' | '5xl' | '6xl';
  requiresRole?: Role[];
}

export type OnboardingStepDef = SpotlightStepDef | AnnouncementStepDef;

export interface OnboardingFlowDef {
  id: FlowId;
  version: number;
  /** When true, the provider starts this flow automatically if unseen. */
  autoStart?: boolean;
  /**
   * When true, bumping `version` makes a previously-seen flow eligible to show
   * again. Opt-in so most flows stay one-and-done.
   */
  reshowOnVersionBump?: boolean;
  steps: OnboardingStepDef[];
}

// ---------------------------------------------------------------------------
// Resolved types: the concrete flow the engine and overlays consume. Copy is a
// plain string and role-gated steps have already been filtered out, so neither
// the reducer nor the overlay components know anything about segment/role.
// ---------------------------------------------------------------------------

export interface SpotlightStep {
  kind: 'spotlight';
  targetId: TargetId;
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
  render: () => ReactNode;
  maxWidth?: '4xl' | '5xl' | '6xl';
}

export type OnboardingStep = SpotlightStep | AnnouncementStep;

export interface OnboardingFlow {
  id: FlowId;
  version: number;
  steps: OnboardingStep[];
}
