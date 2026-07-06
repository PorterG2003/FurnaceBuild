import type { ReactNode } from 'react';
import type { InboxThreadToolbarActionKey } from '@/lib/inbox';
import type { OnboardingHostId } from './onboardingHosts';

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
  navCampaigns: 'navCampaigns',
  navMetrics: 'navMetrics',
  navInbox: 'navInbox',
  navLeads: 'navLeads',
  navSenders: 'navSenders',
  navSettings: 'navSettings',
  /** @deprecated Use per-item nav targets above. Kept for the authoring template. */
  navItems: 'navItems',
  // Master Inbox deep-dive tour (desktop + mobile).
  inboxThreadList: 'inboxThreadList',
  inboxOpenThread: 'inboxOpenThread',
  inboxOpenIndicator: 'inboxOpenIndicator',
  inboxCategories: 'inboxCategories',
  inboxMessagePane: 'inboxMessagePane',
  inboxLeadDetail: 'inboxLeadDetail',
  inboxThreadActions: 'inboxThreadActions',
  inboxMobileActions: 'inboxMobileActions',
  inboxSheetActions: 'inboxSheetActions',
  inboxActionClose: 'inboxActionClose',
  inboxActionBlock: 'inboxActionBlock',
  inboxActionOutOfOffice: 'inboxActionOutOfOffice',
  inboxActionReplace: 'inboxActionReplace',
  inboxActionTags: 'inboxActionTags',
  inboxActionCategory: 'inboxActionCategory',
  inboxActionCloseOverflowTrigger: 'inboxActionCloseOverflowTrigger',
  inboxActionBlockOverflowTrigger: 'inboxActionBlockOverflowTrigger',
  inboxActionOutOfOfficeOverflowTrigger: 'inboxActionOutOfOfficeOverflowTrigger',
  inboxActionReplaceOverflowTrigger: 'inboxActionReplaceOverflowTrigger',
  inboxActionTagsOverflowTrigger: 'inboxActionTagsOverflowTrigger',
  // Account tour.
  accountProfile: 'accountProfile',
  accountNotifications: 'accountNotifications',
  accountTeam: 'accountTeam',
  accountIntegrations: 'accountIntegrations',
  accountWebhooks: 'accountWebhooks',
} as const;

export type TargetId = (typeof TARGETS)[keyof typeof TARGETS];

/**
 * Typed flow ids — the union of live flows. These strings also persist to
 * user_onboarding_state.flow_id (old, removed ids may still exist in the DB;
 * `getFlow` returns undefined for them and they are ignored).
 *
 * Inbox onboarding is split by platform, with two layers per platform: a
 * mandatory basics tour (`inbox` desktop, `inbox-mobile`) that stays mandatory
 * unless its sibling platform tour was already seen, and a single optional
 * follow-up tour (`inbox-followup` desktop, `inbox-followup-mobile`) that walks
 * every thread-level action. The follow-up gets its own platform-specific id
 * because the anchors differ between desktop and mobile.
 */
export type FlowId =
  | 'welcome'
  | 'inbox'
  | 'inbox-mobile'
  | 'inbox-followup'
  | 'inbox-followup-mobile'
  | 'account';

/**
 * Audience segment. Usually drives copy/framing only (`SegmentCopy`), but a
 * registry entry may also branch on segment to add, drop, or replace whole
 * steps — or skip a flow for a segment entirely. See `FlowRegistryEntry`.
 */
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
 * - 'onRequirementMet': Next is hidden until the screen calls
 *   `notifyStepRequirementMet()` (e.g. after the user enables notifications).
 */
export type StepAdvance = 'manual' | 'onTargetPress' | 'onRequirementMet';

/**
 * Optional gates that control when a manual spotlight step's Next button
 * becomes pressable. All configured gates must clear before Next unlocks.
 */
export interface StepNextGate {
  /**
   * Minimum read time before Next unlocks (ms). Renders the progress ring on the
   * Next button so users are nudged to actually read the step.
   */
  dwellMs?: number;
  /**
   * When true, Next starts blocked until the owning screen calls
   * `setCurrentStepNextBlocked(false)` with the required app state in place.
   */
  waitForSignal?: boolean;
}

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
  /**
   * When set, this step's target lives inside the named modal host: the
   * host's own `OnboardingHost` wrapper renders the cutout and the global
   * viewport overlay stays suppressed. Omit for anything on the plain screen
   * surface — never infer this from `targetId` alone, since the same
   * semantic target can live in a modal for one flow/platform and on-screen
   * for another.
   */
  hostId?: OnboardingHostId;
  title: SegmentCopy;
  body: SegmentCopy;
  placement?: SpotlightPlacement;
  advance?: StepAdvance;
  /** Optional gates for manual Next/Done. Ignored when `advance` hides Next. */
  nextGate?: StepNextGate;
  /** When true, a missing target skips just this step instead of aborting the full flow. */
  skipIfTargetMissing?: boolean;
  /**
   * When false, the spotlight measurer will not scroll the target into view
   * before measuring. Defaults to true. Use for anchors inside scrollable
   * regions where scrolling would disrupt the user's context (e.g. inbox thread
   * list content).
   */
  scrollIntoView?: boolean;
  /** When set, the step only renders for these roles (others are filtered out). */
  requiresRole?: Role[];
  /**
   * Authoring-only (inbox toolbar tours): the toolbar action this step
   * demonstrates. Used at resolve time to decide inline vs in-menu ordering.
   * Never reaches the resolved `SpotlightStep`.
   */
  toolbarActionKey?: InboxThreadToolbarActionKey;
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
  /**
   * When true, the flow cannot be skipped or dismissed by the user — the only
   * exits are finishing it or the provider's fail-safe (an unresolvable anchor
   * quietly ends it so nobody is ever trapped).
   */
  mandatory?: boolean;
  /**
   * Downgrades `mandatory` to optional once the named sibling flow has been
   * completed. Used so the platform-specific inbox tours (`inbox` /
   * `inbox-mobile`) both show, but only the first one a user finishes is locked.
   */
  mandatoryUnlessSeen?: FlowId;
  steps: OnboardingStepDef[];
}

/**
 * What a `FlowId` maps to in the registry (`flows/index.ts`).
 *
 * Most flows author a single `OnboardingFlowDef` and only vary wording via
 * `SegmentCopy` — the same steps show for every segment. When a flow's
 * *content*, not just its wording, needs to diverge by segment (e.g. DFY
 * skips a setup tour entirely, or self-serve gets extra depth a DFY client
 * would never need), author a per-segment map instead. A segment with no
 * entry in the map simply never sees that flow.
 */
export type FlowRegistryEntry = OnboardingFlowDef | Partial<Record<Segment, OnboardingFlowDef>>;

// ---------------------------------------------------------------------------
// Resolved types: the concrete flow the engine and overlays consume. Copy is a
// plain string and role-gated steps have already been filtered out, so neither
// the reducer nor the overlay components know anything about segment/role.
// ---------------------------------------------------------------------------

export interface SpotlightStep {
  kind: 'spotlight';
  targetId: TargetId;
  route?: string;
  hostId?: OnboardingHostId;
  title: string;
  body: string;
  placement?: SpotlightPlacement;
  advance?: StepAdvance;
  nextGate?: StepNextGate;
  skipIfTargetMissing?: boolean;
  scrollIntoView?: boolean;
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
  mandatory?: boolean;
  mandatoryUnlessSeen?: FlowId;
  steps: OnboardingStep[];
}
