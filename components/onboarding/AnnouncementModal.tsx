import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { AnnouncementStep } from '@/lib/onboarding/types';
import type { Progress } from '@/lib/onboarding/engine';
import { StepControls } from './StepControls';
import { AnnouncementHero } from './art/AnnouncementHero';

interface AnnouncementModalProps {
  step: AnnouncementStep;
  progress: Progress | null;
  isLastStep: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onBack: () => void;
  reducedMotion: boolean;
  /** When set (non-mandatory flow), StepControls shows a Skip link. */
  onSkip?: () => void;
}

/**
 * Large modal for announcement steps. The copy lives *inside* the visual
 * (`AnnouncementHero`) rather than in the modal header, and the dead X is
 * suppressed — the only exits are Skip (non-mandatory) or finishing the flow.
 */
export function AnnouncementModal({
  step,
  progress,
  isLastStep,
  canGoBack,
  onNext,
  onBack,
  reducedMotion,
  onSkip,
}: AnnouncementModalProps) {
  return (
    <BaseModal
      visible
      onClose={() => {}}
      onBack={canGoBack ? onBack : undefined}
      hideCloseButton
      noPadding
      title=""
      maxWidth={step.maxWidth ?? '4xl'}
      footer={
        <StepControls
          progress={progress}
          canGoBack={canGoBack}
          showNext
          isLastStep={isLastStep}
          onBack={onBack}
          onNext={onNext}
          reducedMotion={reducedMotion}
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
        <AnnouncementHero>{step.render()}</AnnouncementHero>
      </Suspense>
    </BaseModal>
  );
}
