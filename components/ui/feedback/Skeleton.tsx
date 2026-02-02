import React from 'react';
import { useEffect, useRef } from 'react';
import { View, Animated, StyleProp, ViewStyle } from 'react-native';

interface SkeletonProps {
  /**
   * Optional className for the container (NativeWind)
   */
  className?: string;
  /**
   * Optional style for the container
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Whether to show a subtle pulse animation (default: true)
   */
  animate?: boolean;
  /**
   * Border radius (default: 6)
   */
  borderRadius?: number;
}

/**
 * Skeleton placeholder block for loading states.
 * Renders a gray rounded rectangle with optional pulse animation.
 */
export function Skeleton({
  className,
  style,
  animate = true,
  borderRadius = 6,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animate, opacity]);

  return (
    <Animated.View
      className={className}
      style={[
        {
          backgroundColor: '#2A2A2A',
          borderRadius,
          opacity: animate ? opacity : 0.5,
        },
        style,
      ]}
    />
  );
}
