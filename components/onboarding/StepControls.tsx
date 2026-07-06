import { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import type { Progress } from '@/lib/onboarding/engine';
import { StepDwellDial } from './StepDwellDial';

/** Tailwind `rounded-lg` = 0.5rem. Used so the dwell ring hugs the Next button. */
const NEXT_BORDER_RADIUS = 8;

interface StepControlsNextGate {
  /** When true, Next/Done is visible but not pressable. */
  blocked?: boolean;
  /**
   * Minimum read time before Next unlocks (ms). Renders the progress ring on the
   * Next button.
   */
  dwellMs?: number;
}

interface StepControlsProps {
  progress: Progress | null;
  /** Show the Back button (hidden on the first step). */
  canGoBack: boolean;
  /** Show the Next/Done button (hidden for onTargetPress spotlight steps). */
  showNext: boolean;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
  /** Optional gates controlling when Next/Done unlocks. */
  nextGate?: StepControlsNextGate;
  reducedMotion?: boolean;
  /**
   * When set (non-mandatory flows), shows a small "Skip tour" link that ends the
   * flow. Omitted entirely for mandatory flows.
   */
  onSkip?: () => void;
}

/**
 * Shared footer chrome for every onboarding step: progress dots, an optional
 * Skip link, and Back / Next (or Done) with an optional dwell ring.
 */
export function StepControls({
  progress,
  canGoBack,
  showNext,
  isLastStep,
  onBack,
  onNext,
  nextGate,
  reducedMotion = false,
  onSkip,
}: StepControlsProps) {
  const blocked = nextGate?.blocked ?? false;
  const dwellMs = nextGate?.dwellMs ?? 0;
  const dwellActive = showNext && dwellMs > 0;
  const [dwellComplete, setDwellComplete] = useState(!dwellActive);
  const [buttonSize, setButtonSize] = useState<{ width: number; height: number } | null>(null);

  const onButtonLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setButtonSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const gated = blocked || (dwellActive && !dwellComplete);
  const showDial = dwellActive && !dwellComplete && buttonSize != null;

  return (
    <View className="flex-row items-center justify-between mt-5">
      <View className="items-start gap-2">
        {progress && progress.total > 1 ? (
          <View className="flex-row items-center gap-1.5">
            {Array.from({ length: progress.total }).map((_, i) => (
              <View
                key={i}
                className={`h-1.5 rounded-full ${
                  i === progress.index ? 'w-4 bg-brand-orange' : 'w-1.5 bg-[#3A3A3A]'
                }`}
              />
            ))}
          </View>
        ) : null}
        {onSkip ? (
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
            hitSlop={8}
            className="active:opacity-70"
          >
            <Text className="text-gray-500 font-instrument text-xs">Skip tour</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="flex-row items-center gap-2">
        {canGoBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="px-4 py-2 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] active:opacity-80"
          >
            <Text className="text-white font-instrument text-sm">Back</Text>
          </Pressable>
        ) : null}
        {showNext ? (
          <View onLayout={onButtonLayout} style={{ position: 'relative' }}>
            <Pressable
              onPress={onNext}
              disabled={gated}
              accessibilityRole="button"
              accessibilityLabel={
                gated && dwellActive
                  ? 'Next (unlocks in a moment)'
                  : gated
                    ? 'Next (complete this step first)'
                    : isLastStep
                      ? 'Done'
                      : 'Next'
              }
              accessibilityState={{ disabled: gated }}
              className={`px-4 py-2 rounded-lg active:opacity-80 ${
                gated ? 'bg-brand-orange/40' : 'bg-brand-orange'
              }`}
            >
              <Text
                className={`font-instrument-semibold text-sm ${gated ? 'text-white/60' : 'text-white'}`}
              >
                {isLastStep ? 'Done' : 'Next'}
              </Text>
            </Pressable>
            {showDial ? (
              <StepDwellDial
                width={buttonSize.width}
                height={buttonSize.height}
                borderRadius={NEXT_BORDER_RADIUS}
                durationMs={dwellMs}
                reducedMotion={reducedMotion}
                onComplete={() => setDwellComplete(true)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
