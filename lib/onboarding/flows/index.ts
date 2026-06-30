import type { FlowId, OnboardingFlowDef } from '../types';

/**
 * Flow registry.
 *
 * Flows are authored as one file per flow in this directory and registered
 * here. The registry is intentionally EMPTY for now: the onboarding engine,
 * provider, triggers and overlays are all wired, but no flow auto-starts and
 * nothing triggers on screens until real flows land. See `_template.ts` for the
 * authoring shape.
 *
 * `Partial<Record<FlowId, ...>>` means completeness is not required — a `FlowId`
 * can exist in the type union without a registered flow, and `getFlow` returns
 * `undefined` for it (the provider no-ops on a missing flow).
 */
export const FLOWS: Partial<Record<FlowId, OnboardingFlowDef>> = {};

export const ALL_FLOWS: OnboardingFlowDef[] = Object.values(FLOWS).filter(
  (flow): flow is OnboardingFlowDef => Boolean(flow),
);

export function getFlow(id: FlowId): OnboardingFlowDef | undefined {
  return FLOWS[id];
}
