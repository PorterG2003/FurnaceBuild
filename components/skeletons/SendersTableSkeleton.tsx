import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

const useNativeDriver = typeof window === 'undefined';
const STAGGER_DELAY_MS = 60;

function StaggeredFadeIn({ index, children }: { index: number; children: ReactNode }) {
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

function CardSkeletonRow({ index }: { index: number }) {
  return (
    <StaggeredFadeIn index={index}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 min-w-0 flex-row flex-wrap items-center gap-2">
            <Skeleton style={{ width: 140, height: 16, borderRadius: 4, flexShrink: 1 }} />
            <Skeleton style={{ width: 72, height: 22, borderRadius: 6, flexShrink: 0 }} />
          </View>
          <Skeleton style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0 }} />
        </View>
        <Skeleton
          style={{ width: '100%', height: 14, borderRadius: 4, marginTop: 8, maxWidth: '100%' }}
        />
      </View>
    </StaggeredFadeIn>
  );
}

export function SendersCardListSkeleton() {
  const rowCount = 5;
  return (
    <View className="gap-3">
      {Array.from({ length: rowCount }).map((_, i) => (
        <CardSkeletonRow key={i} index={i} />
      ))}
    </View>
  );
}
