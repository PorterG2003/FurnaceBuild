import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated, useWindowDimensions } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';

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

function SingleStatSkeleton() {
  return (
    <View className="items-center">
      <Skeleton className="w-4 h-4 rounded mb-1" />
      <Skeleton className="w-7 h-4 rounded" />
      <Skeleton className="w-10 h-3 rounded mt-1" />
    </View>
  );
}

function SingleCampaignCardSkeleton({ index, isMobileLayout }: { index: number; isMobileLayout: boolean }) {
  const campaignBlockDesktop = (
    <View className="flex-row gap-3 flex-1 max-w-[35%] min-w-0">
      <View className="mt-0.5">
        <Skeleton className="w-14 h-14 rounded-full" />
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 mb-1 flex-wrap">
          <Skeleton className="w-[180px] h-5 rounded" />
          <Skeleton className="w-[72px] h-6 rounded-lg" />
        </View>
        <Skeleton className="w-[220px] h-3.5 rounded mb-1" />
        <Skeleton className="w-[120px] h-3 rounded" />
      </View>
    </View>
  );

  const statsBlockDesktop = (
    <View className="flex-row flex-none basis-[40%] shrink-0 justify-around">
      <View className="w-[72px] items-center">
        <SingleStatSkeleton />
      </View>
      <View className="w-[72px] items-center">
        <SingleStatSkeleton />
      </View>
      <View className="w-[88px] items-center">
        <SingleStatSkeleton />
      </View>
      <View className="w-[72px] items-center">
        <SingleStatSkeleton />
      </View>
    </View>
  );

  const toolsBlock = (
    <View className="flex-row gap-2 items-center">
      <Skeleton className="w-[100px] h-8 rounded-lg" />
      <Skeleton className="w-11 h-11 rounded-lg" />
      <Skeleton className="w-11 h-11 rounded-lg" />
    </View>
  );

  if (isMobileLayout) {
    return (
      <StaggeredFadeIn index={index}>
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4">
          {/* Block 1 — Identity (dial 48 + smaller name/pill/date/next) */}
          <View className="flex-row gap-3 mb-3">
            <View className="mt-0.5">
              <Skeleton className="w-12 h-12 rounded-full" />
            </View>
            <View className="flex-1 min-w-0">
              <Skeleton className="w-[140px] h-4 rounded mb-1" />
              <Skeleton className="w-[100px] h-3 rounded mb-1" />
              <Skeleton className="w-[180px] h-3 rounded" />
            </View>
          </View>
          {/* Block 2 — 4-column stats row (no margin below) */}
          <View className="flex-row justify-around items-start">
            <View className="flex-1 items-center">
              <SingleStatSkeleton />
            </View>
            <View className="flex-1 items-center">
              <SingleStatSkeleton />
            </View>
            <View className="flex-1 items-center">
              <SingleStatSkeleton />
            </View>
            <View className="flex-1 items-center">
              <SingleStatSkeleton />
            </View>
          </View>
        </View>
      </StaggeredFadeIn>
    );
  }

  return (
    <StaggeredFadeIn index={index}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4 relative">
        <View className="flex-row items-start gap-4">
          {campaignBlockDesktop}
          {statsBlockDesktop}
        </View>
        <View className="absolute right-4 top-4">
          {toolsBlock}
        </View>
      </View>
    </StaggeredFadeIn>
  );
}

export function CampaignListSkeleton() {
  const { width } = useWindowDimensions();
  const isMobileLayout = width < LAYOUT_BREAKPOINT;

  return (
    <View>
      {[0, 1, 2, 3].map((i) => (
        <SingleCampaignCardSkeleton key={i} index={i} isMobileLayout={isMobileLayout} />
      ))}
    </View>
  );
}
