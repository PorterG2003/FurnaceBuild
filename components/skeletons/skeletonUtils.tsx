import { useEffect, useRef, type ReactNode } from 'react';
import { Animated } from 'react-native';

const useNativeDriver = typeof window === 'undefined';
const STAGGER_DELAY_MS = 60;

export function StaggeredFadeIn({ index, children }: { index: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver,
      }).start();
    }, index * STAGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [index, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
