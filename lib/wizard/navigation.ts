import { useCallback } from 'react';

type UseWizardNavigationParams = {
  stepIndex: number;
  stepCount: number;
  setStepIndex: (updater: (current: number) => number) => void;
  validateTransition?: (params: {
    currentStepIndex: number;
    targetStepIndex: number;
  }) => string | null;
  onValidationError?: (message: string) => void;
};

export function useWizardNavigation({
  stepIndex,
  stepCount,
  setStepIndex,
  validateTransition,
  onValidationError,
}: UseWizardNavigationParams) {
  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, [setStepIndex]);

  const goToStep = useCallback(
    (targetStepIndex: number) => {
      const clampedTargetStepIndex = Math.max(0, Math.min(targetStepIndex, stepCount - 1));
      const error = validateTransition?.({
        currentStepIndex: stepIndex,
        targetStepIndex: clampedTargetStepIndex,
      });
      if (error) {
        onValidationError?.(error);
        return false;
      }
      setStepIndex(() => clampedTargetStepIndex);
      return true;
    },
    [onValidationError, setStepIndex, stepCount, stepIndex, validateTransition],
  );

  const goNext = useCallback(() => {
    if (stepIndex >= stepCount - 1) {
      return false;
    }
    return goToStep(stepIndex + 1);
  }, [goToStep, stepCount, stepIndex]);

  return {
    goBack,
    goNext,
    goToStep,
  };
}
