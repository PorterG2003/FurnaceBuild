import { resolveSpotlightSurface } from '@/lib/onboarding/onboardingHosts';
import { useOnboarding } from './context';
import { AnnouncementModal } from './AnnouncementModal';
import { SpotlightOverlay } from './SpotlightOverlay';

/**
 * Renders the active onboarding step. Exhaustively switches on `step.kind` so
 * adding a new kind is a compile-time error here.
 */
export function OnboardingOverlay() {
  const {
    currentStep,
    progress,
    blockingOverlayPresent,
    currentFlowMandatory,
    reducedMotion,
    next,
    back,
    dismissFlow,
  } = useOnboarding();

  if (!currentStep) return null;

  const isLastStep = progress ? progress.index === progress.total - 1 : false;
  const canGoBack = progress ? progress.index > 0 : false;
  // Non-mandatory flows can be skipped; mandatory ones have no skip affordance.
  const onSkip = currentFlowMandatory ? undefined : dismissFlow;

  switch (currentStep.kind) {
    case 'announcement':
      return (
        <AnnouncementModal
          step={currentStep}
          progress={progress}
          isLastStep={isLastStep}
          canGoBack={canGoBack}
          onNext={next}
          onBack={back}
          reducedMotion={reducedMotion}
          onSkip={onSkip}
        />
      );
    case 'spotlight': {
      // Route the step to a render surface:
      // - `global`: the app-root viewport overlay (this component).
      // - `host`:   an in-modal `OnboardingHost` renders it; skip here.
      // - `null`:   an unrelated blocking modal is open, or not a spotlight; pause.
      // The announcement case is itself a modal, so it is exempt from this gate.
      const surface = resolveSpotlightSurface(currentStep, blockingOverlayPresent);
      if (surface !== 'global') return null;
      return (
        <SpotlightOverlay
          key={progress ? `${progress.index}:${currentStep.targetId}` : currentStep.targetId}
          step={currentStep}
          isLastStep={isLastStep}
          canGoBack={canGoBack}
          onSkip={onSkip}
          scope="viewport"
        />
      );
    }
    default: {
      const _never: never = currentStep;
      return _never ?? null;
    }
  }
}
