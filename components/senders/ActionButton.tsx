import { useState } from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity } from 'react-native';

export interface ActionButtonProps {
  onPress: () => void;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label?: string;
  variant: 'blue' | 'red';
  disabled?: boolean;
  isLoading?: boolean;
}

export function ActionButton({
  onPress,
  icon: Icon,
  label,
  variant,
  disabled = false,
  isLoading = false,
}: ActionButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const iconOnly = label === undefined || label === '';

  const colors = {
    blue: {
      bg: 'bg-blue-500/20',
      bgHover: 'bg-blue-500/30',
      border: 'border-blue-500/30',
      borderHover: 'border-blue-500/40',
      text: 'text-blue-400',
      iconColor: '#60A5FA',
    },
    red: {
      bg: 'bg-red-500/20',
      bgHover: 'bg-red-500/30',
      border: 'border-red-500/30',
      borderHover: 'border-red-500/40',
      text: 'text-red-400',
      iconColor: '#F87171',
    },
  };

  const colorScheme = colors[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.7}
      onPressIn={() => setIsHovered(true)}
      onPressOut={() => setIsHovered(false)}
      className={`rounded-lg border flex-row items-center justify-center ${
        iconOnly ? 'p-1.5' : 'px-2.5 py-1.5 gap-1.5'
      } ${
        isHovered && !disabled && !isLoading
          ? colorScheme.bgHover + ' ' + colorScheme.borderHover
          : colorScheme.bg + ' ' + colorScheme.border
      }`}
      style={{
        opacity: disabled || isLoading ? 0.5 : 1,
      }}
      // @ts-ignore - web-only prop
      onMouseEnter={() => Platform.OS === 'web' && !disabled && !isLoading && setIsHovered(true)}
      onMouseLeave={() => Platform.OS === 'web' && setIsHovered(false)}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={colorScheme.iconColor} />
      ) : (
        <>
          <Icon size={iconOnly ? 16 : 14} color={colorScheme.iconColor} />
          {!iconOnly && (
            <Text className={`${colorScheme.text} font-instrument-medium text-xs`}>{label}</Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
