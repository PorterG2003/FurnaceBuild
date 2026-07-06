import type { FlowId, FlowRegistryEntry, OnboardingFlowDef, Segment } from '../types';
import { welcomeFlow } from './welcome';
import { inboxFlow } from './inbox';
import { inboxMobileFlow } from './inbox-mobile';
import { inboxFollowupFlow } from './inbox-followup';
import { inboxFollowupMobileFlow } from './inbox-followup-mobile';
import { accountFlow } from './account';

/**
 * Live onboarding flows, in scheduler-priority order.
 *
 * - `welcome` — auto-starts at signup; the six-item nav walk.
 * - `inbox` / `inbox-mobile` — short mandatory inbox basics, split by platform.
 * - `inbox-followup*` — optional inbox follow-up actions, registered after the
 *   basics tour so the next unseen lesson wins.
 * - `account` — reply-alerts + team/API setup.
 */
export const FLOWS: Partial<Record<FlowId, FlowRegistryEntry>> = {
  welcome: welcomeFlow,
  inbox: inboxFlow,
  'inbox-mobile': inboxMobileFlow,
  'inbox-followup': inboxFollowupFlow,
  'inbox-followup-mobile': inboxFollowupMobileFlow,
  account: accountFlow,
};

function pickForSegment(entry: FlowRegistryEntry, segment: Segment): OnboardingFlowDef | undefined {
  // A plain `OnboardingFlowDef` always has `steps`; a per-segment map never does.
  if ('steps' in entry) return entry;
  return entry[segment];
}

export function getFlow(id: FlowId, segment: Segment): OnboardingFlowDef | undefined {
  const entry = FLOWS[id];
  return entry ? pickForSegment(entry, segment) : undefined;
}

/** All flows a given segment can see, in registry order (scheduler priority). */
export function getAllFlows(segment: Segment): OnboardingFlowDef[] {
  return Object.values(FLOWS)
    .map((entry) => (entry ? pickForSegment(entry, segment) : undefined))
    .filter((flow): flow is OnboardingFlowDef => Boolean(flow));
}
