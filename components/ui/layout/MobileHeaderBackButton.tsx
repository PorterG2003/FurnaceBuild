import React from 'react';
import { Pressable, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronLeftIcon } from 'react-native-heroicons/outline';
import { cn } from '@/lib/cn';

export interface MobileHeaderBackButtonProps {
  onPress: () => void;
  label?: string;
  accessibilityLabel?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  hitSlop?: PressableProps['hitSlop'];
}

/**
 * Chevron + label row matching mobile detail page headers (no background).
 */
export function MobileHeaderBackButton({
  onPress,
  label = 'Back',
  accessibilityLabel = 'Back',
  className,
  style,
  hitSlop = 12,
}: MobileHeaderBackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      className={cn('flex-row items-center py-0.5 -ml-1', className)}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
    >
      <ChevronLeftIcon size={18} color="#9CA3AF" />
      <Text className="text-gray-400 font-instrument text-sm ml-1">{label}</Text>
    </Pressable>
  );
}
