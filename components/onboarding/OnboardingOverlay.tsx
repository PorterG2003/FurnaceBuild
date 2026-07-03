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
    case 'spotlight':
      // Pause (don't render) while an external modal/sheet is open so we never
      // fight another overlay. The announcement case is itself a modal, so it
      // is intentionally exempt from this gate.
      if (blockingOverlayPresent) return null;
      return (
        <SpotlightOverlay
          step={currentStep}
          isLastStep={isLastStep}
          canGoBack={canGoBack}
          onSkip={onSkip}
        />
      );
    default: {
      const _never: never = currentStep;
      return _never ?? null;
    }
  }
}
