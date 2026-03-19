import React from 'react';
import { View, Text } from 'react-native';

export interface StatColumnProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  value: number;
  label: string;
  color: string;
  pct?: number;
  /** Use 'xs' on very narrow screens for smaller icon and text */
  size?: 'default' | 'xs';
}

/**
 * Generic stat cell: icon, value (with optional pct), and label.
 * Used in campaign cards in row layout (desktop and mobile). Label is centered.
 */
export function StatColumn({
  icon: Icon,
  value,
  label,
  color,
  pct,
  size = 'default',
}: StatColumnProps) {
  const iconSize = size === 'xs' ? 14 : 16;
  return (
    <View className="items-center">
      <View className="mb-1">
        <Icon size={iconSize} color={color} />
      </View>
      <Text
        className={size === 'xs' ? 'font-instrument-semibold text-sm' : 'font-instrument-semibold text-base'}
        style={{ color }}
      >
        {value}
        {pct !== undefined ? (
          <Text className={size === 'xs' ? 'text-gray-500 font-instrument text-xs' : 'text-gray-500 font-instrument text-sm'}> ({pct}%)</Text>
        ) : null}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs mt-0.5 text-center">
        {label}
      </Text>
    </View>
  );
}
