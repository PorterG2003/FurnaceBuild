import React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

interface MeasuredSectionProps {
  id: string;
  onHeightMeasured: (id: string, height: number) => void;
  children: React.ReactNode;
}

/**
 * Wraps content in a View with onLayout and reports height to the parent.
 * Used by BalancedTwoColumnLayout to measure section heights for bin packing.
 */
export function MeasuredSection({ id, onHeightMeasured, children }: MeasuredSectionProps) {
  const handleLayout = (e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    onHeightMeasured(id, height);
  };

  return <View onLayout={handleLayout}>{children}</View>;
}
