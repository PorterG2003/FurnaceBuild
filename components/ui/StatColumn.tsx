import React from 'react';
import { View, Text } from 'react-native';

export interface StatColumnProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  value: number | string;
  label: string;
  color: string;
  pct?: number;
  /** Second-class parenthetical, e.g. a raw count beside a rate. Overrides `pct`. */
  secondary?: number | string;
  /** Optional control rendered beside the label (help icon, etc.). */
  labelAccessory?: React.ReactNode;
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
  secondary,
  labelAccessory,
  size = 'default',
}: StatColumnProps) {
  const iconSize = size === 'xs' ? 12 : 16;
  const secondaryText = secondary !== undefined ? ` (${secondary})` : pct !== undefined ? ` (${pct}%)` : null;
  const secondaryClass =
    size === 'xs' ? 'text-gray-500 font-instrument text-[10px]' : 'text-gray-500 font-instrument text-sm';
  return (
    <View className="items-center">
      <View className={size === 'xs' ? 'mb-0.5' : 'mb-1'}>
        <Icon size={iconSize} color={color} />
      </View>
      <Text
        className={size === 'xs' ? 'font-instrument-semibold text-xs' : 'font-instrument-semibold text-base'}
        style={{ color, fontVariant: ['tabular-nums'] }}
        numberOfLines={size === 'xs' ? 1 : undefined}
      >
        {value}
        {secondaryText ? <Text className={secondaryClass}>{secondaryText}</Text> : null}
      </Text>
      <View className="flex-row items-center justify-center gap-0.5 mt-0.5">
        <Text
          className={
            size === 'xs'
              ? 'text-gray-500 font-instrument text-[10px] text-center'
              : 'text-gray-500 font-instrument text-xs text-center'
          }
          numberOfLines={1}
        >
          {label}
        </Text>
        {labelAccessory}
      </View>
    </View>
  );
}
