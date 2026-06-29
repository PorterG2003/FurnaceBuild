import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { AnnouncementStep } from '@/lib/onboarding/types';
import type { Progress } from '@/lib/onboarding/engine';
import { StepControls } from './StepControls';

interface AnnouncementModalProps {
  step: AnnouncementStep;
  progress: Progress | null;
  isLastStep: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Large modal for announcement steps. Wraps the shared BaseModal and renders
 * the step's (lazy-loaded) demo node inside a Suspense boundary.
 */
export function AnnouncementModal({
  step,
  progress,
  isLastStep,
  canGoBack,
  onNext,
  onBack,
  onSkip,
}: AnnouncementModalProps) {
  return (
    <BaseModal
      visible
      onClose={onSkip}
      title={step.title ?? ''}
      description={step.description}
      maxWidth={step.maxWidth ?? '5xl'}
      footer={
        <StepControls
          progress={progress}
          canGoBack={canGoBack}
          showNext
          isLastStep={isLastStep}
          onBack={onBack}
          onNext={onNext}
          onSkip={onSkip}
        />
      }
    >
      <Suspense
        fallback={
          <View className="h-48 items-center justify-center">
            <ActivityIndicator color="#f85102" />
          </View>
        }
      >
        {step.render()}
      </Suspense>
    </BaseModal>
  );
}
