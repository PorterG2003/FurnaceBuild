import { Text, View, type LayoutChangeEvent } from 'react-native';
import type { Progress } from '@/lib/onboarding/engine';
import type { SpotlightStep } from '@/lib/onboarding/types';
import { StepControls } from './StepControls';

interface SpotlightCalloutProps {
  step: SpotlightStep;
  progress: Progress | null;
  canGoBack: boolean;
  showNext: boolean;
  isLastStep: boolean;
  /** When true, Next/Done is visible but not pressable. */
  nextDisabled: boolean;
  reducedMotion: boolean;
  onBack: () => void;
  onNext: () => void;
  /** When set (non-mandatory flow), StepControls shows a Skip link. */
  onSkip?: () => void;
  /** Fixed width (desktop viewport callout). Omit to fill the parent. */
  width?: number;
  /** Reports the rendered card size so the overlay can re-anchor it. */
  onLayout?: (e: LayoutChangeEvent) => void;
}

/**
 * The card shown for a spotlight step: title, body, and step controls. Shared by
 * every spotlight surface (viewport overlay and in-modal host) so the chrome is
 * identical everywhere.
 */
export function SpotlightCallout({
  step,
  progress,
  canGoBack,
  showNext,
  isLastStep,
  nextDisabled,
  reducedMotion,
  onBack,
  onNext,
  onSkip,
  width,
  onLayout,
}: SpotlightCalloutProps) {
  return (
    <View
      onLayout={onLayout}
      className="rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-5"
      style={width != null ? { width } : undefined}
    >
      <Text className="text-white font-instrument-semibold text-lg mb-1.5">{step.title}</Text>
      <Text className="text-gray-300 font-instrument text-sm">{step.body}</Text>
      <StepControls
        key={progress ? progress.index : step.targetId}
        progress={progress}
        canGoBack={canGoBack}
        showNext={showNext}
        isLastStep={isLastStep}
        onBack={onBack}
        onNext={onNext}
        nextGate={{
          blocked: nextDisabled,
          dwellMs: step.nextGate?.dwellMs,
        }}
        reducedMotion={reducedMotion}
        onSkip={onSkip}
      />
    </View>
  );
}
