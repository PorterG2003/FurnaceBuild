import type { OnboardingStep } from './types';

/**
 * A modal surface that can host onboarding spotlight steps *inside* itself
 * (rendering an in-container cutout) instead of the app-root viewport overlay.
 *
 * Steps opt into a host explicitly via `hostId` (see `SpotlightStepDef` /
 * `SpotlightStep` in `./types`) rather than the surface being inferred from
 * the target they highlight — the same semantic `TargetId` can render on the
 * plain screen for one flow and inside a modal host for another (e.g. desktop
 * vs mobile inbox action tours), so routing must be flow-authored, not target-
 * derived.
 */
export type OnboardingHostId = 'inboxMessageActions';

/** Which surface should render the spotlight for the current step. */
export type SpotlightSurface = 'global' | 'host';

/**
 * Pure routing decision for the active step:
 * - `null` when there is no spotlight step, or an unrelated blocking modal is
 *   open (global overlay stays suppressed as before).
 * - `'host'` when the step declares a `hostId` — its own host wrapper renders
 *   it, so the global overlay must not.
 * - `'global'` otherwise.
 *
 * A host-targeted step resolves to `'host'` regardless of `blockingOverlayPresent`
 * because its own host sheet is the modal in question (and registers itself as
 * non-blocking while its step is active).
 */
export function resolveSpotlightSurface(
  step: OnboardingStep | null,
  blockingOverlayPresent: boolean,
): SpotlightSurface | null {
  if (!step || step.kind !== 'spotlight') return null;
  if (step.hostId) return 'host';
  if (blockingOverlayPresent) return null;
  return 'global';
}
