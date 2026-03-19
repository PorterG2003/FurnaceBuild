import React, { type ReactNode } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from './constants';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional; when omitted (e.g. on mobile), header shows only title and subtitle */
  primaryAction?: ReactNode;
}

/**
 * Responsive page header: row layout (title+subtitle left, primaryAction right when provided).
 * Title is slightly smaller on mobile (text-2xl) than desktop (text-3xl).
 */
export function PageHeader({ title, subtitle, primaryAction }: PageHeaderProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <View className="flex-row items-center justify-between mb-6">
      <View className="flex-1 min-w-0">
        <Text
          className={
            isMobile
              ? 'text-2xl font-instrument-semibold text-white mb-1'
              : 'text-3xl font-instrument-semibold text-white mb-2'
          }
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-gray-400 font-instrument" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {primaryAction != null ? primaryAction : null}
    </View>
  );
}
