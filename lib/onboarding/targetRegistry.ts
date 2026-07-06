import type { OnboardingHostId } from './onboardingHosts';
import type { OnboardingStep, TargetId } from './types';

/**
 * Registry surface for a target ref: the global viewport, or a specific modal
 * host. Lets the same `TargetId` register a different physical ref per
 * surface (e.g. a desktop toolbar button and a mobile sheet row sharing the
 * `inboxActionClose` id) without one overwriting the other.
 */
export type TargetSurface = 'global' | OnboardingHostId;

/** Composite registry key so the same TargetId can register once per surface. */
export function targetKey(id: TargetId, surface: TargetSurface): string {
  return `${surface}:${id}`;
}

/**
 * Effective surface for a registry lookup: an explicit surface wins (the
 * caller knows where its own ref lives), otherwise fall back to the active
 * step's `hostId`, since that is the surface the current spotlight step
 * renders into. Defaults to `global`.
 */
export function resolveTargetSurface(
  explicitSurface: TargetSurface | undefined,
  activeStep: OnboardingStep | null,
): TargetSurface {
  if (explicitSurface) return explicitSurface;
  if (activeStep?.kind === 'spotlight' && activeStep.hostId) return activeStep.hostId;
  return 'global';
}
