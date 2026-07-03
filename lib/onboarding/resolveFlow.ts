import type {
  AnnouncementStep,
  AnnouncementStepDef,
  OnboardingFlow,
  OnboardingFlowDef,
  OnboardingStep,
  OnboardingStepDef,
  Role,
  Segment,
  SegmentCopy,
  SpotlightStep,
  SpotlightStepDef,
} from './types';

/** Picks the copy for a segment, falling back to `default`. */
export function resolveCopy(copy: SegmentCopy, segment: Segment): string {
  if (typeof copy === 'string') return copy;
  return copy[segment] ?? copy.default;
}

export interface ResolveContext {
  segment: Segment;
  role: Role;
}

function stepAppliesToRole(step: OnboardingStepDef, role: Role): boolean {
  return !step.requiresRole || step.requiresRole.includes(role);
}

function resolveSpotlight(step: SpotlightStepDef, segment: Segment): SpotlightStep {
  return {
    kind: 'spotlight',
    targetId: step.targetId,
    route: step.route,
    title: resolveCopy(step.title, segment),
    body: resolveCopy(step.body, segment),
    placement: step.placement,
    advance: step.advance,
    dwellMs: step.dwellMs,
  };
}

function resolveAnnouncement(step: AnnouncementStepDef, segment: Segment): AnnouncementStep {
  return {
    kind: 'announcement',
    route: step.route,
    title: step.title != null ? resolveCopy(step.title, segment) : undefined,
    description: step.description != null ? resolveCopy(step.description, segment) : undefined,
    render: step.render,
    maxWidth: step.maxWidth,
  };
}

/**
 * Turns an authoring-time flow definition into the concrete flow the engine and
 * overlays consume: copy is resolved to plain strings for the segment, and
 * steps whose `requiresRole` excludes the current role are dropped. If filtering
 * yields zero steps the flow is trivially complete (the engine handles empty
 * flows by completing immediately).
 */
export function resolveFlow(def: OnboardingFlowDef, ctx: ResolveContext): OnboardingFlow {
  const steps: OnboardingStep[] = def.steps
    .filter((step) => stepAppliesToRole(step, ctx.role))
    .map((step) =>
      step.kind === 'announcement'
        ? resolveAnnouncement(step, ctx.segment)
        : resolveSpotlight(step, ctx.segment),
    );

  return {
    id: def.id,
    version: def.version,
    mandatory: def.mandatory,
    mandatoryUnlessSeen: def.mandatoryUnlessSeen,
    steps,
  };
}
