import { type ReactNode, useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDownIcon } from 'react-native-heroicons/outline';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

interface ReviewSectionProps {
  title: string;
  summary: string;
  expanded: boolean;
  onPress: () => void;
  children: ReactNode;
}

export function ReviewSection({
  title,
  summary,
  expanded,
  onPress,
  children,
}: ReviewSectionProps) {
  const chevronRotation = useSharedValue(expanded ? 180 : 0);
  const contentOpacity = useSharedValue(expanded ? 1 : 0);
  const contentTranslateY = useSharedValue(expanded ? 0 : -6);

  useEffect(() => {
    chevronRotation.value = withTiming(expanded ? 180 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });

    if (expanded) {
      contentOpacity.value = 0;
      contentTranslateY.value = -6;
      contentOpacity.value = withTiming(1, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      contentTranslateY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [expanded, chevronRotation, contentOpacity, contentTranslateY]);

  const chevronAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] overflow-hidden">
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        className="px-4 py-4 flex-row items-center justify-between gap-3"
      >
        <View className="flex-1">
          <Text className="text-white text-sm font-instrument-medium">{title}</Text>
          <Text className="text-gray-400 text-xs font-instrument mt-1">{summary}</Text>
        </View>
        <View className="h-8 w-8 rounded-full bg-[#1F1F1F] border border-[#2A2A2A] items-center justify-center">
          <Animated.View style={chevronAnimatedStyle}>
            <ChevronDownIcon size={16} color="#9CA3AF" />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View className="px-4 pb-4 border-t border-[#2A2A2A] bg-[#111111]">
          <Animated.View className="pt-4" style={contentAnimatedStyle}>
            {children}
          </Animated.View>
        </View>
      )}
    </View>
  );
}
