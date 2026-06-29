import { Pressable, Text, View } from 'react-native';
import type { Progress } from '@/lib/onboarding/engine';

interface StepControlsProps {
  progress: Progress | null;
  /** Show the Back button (hidden on the first step). */
  canGoBack: boolean;
  /** Show the Next/Done button (hidden for onTargetPress spotlight steps). */
  showNext: boolean;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * Shared footer chrome for every onboarding step: a progress dots row plus
 * Skip / Back / Next (or Done) controls. Kept presentation-only.
 */
export function StepControls({
  progress,
  canGoBack,
  showNext,
  isLastStep,
  onBack,
  onNext,
  onSkip,
}: StepControlsProps) {
  return (
    <View className="flex-row items-center justify-between mt-5">
      <View className="flex-row items-center gap-3">
        {progress && progress.total > 1 ? (
          <View className="flex-row items-center gap-1.5">
            {Array.from({ length: progress.total }).map((_, i) => (
              <View
                key={i}
                className={`h-1.5 rounded-full ${
                  i === progress.index
                    ? 'w-4 bg-brand-orange'
                    : 'w-1.5 bg-[#3A3A3A]'
                }`}
              />
            ))}
          </View>
        ) : (
          <View />
        )}
      </View>

      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip"
          className="px-3 py-2 rounded-lg active:opacity-70"
        >
          <Text className="text-gray-400 font-instrument text-sm">Skip</Text>
        </Pressable>
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
          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? 'Done' : 'Next'}
            className="px-4 py-2 rounded-lg bg-brand-orange active:opacity-80"
          >
            <Text className="text-white font-instrument-semibold text-sm">
              {isLastStep ? 'Done' : 'Next'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
