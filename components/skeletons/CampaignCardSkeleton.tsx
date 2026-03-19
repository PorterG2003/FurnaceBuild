import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated, useWindowDimensions } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Card } from '@/components/ui/Card';

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
      <Skeleton style={{ width: 16, height: 16, borderRadius: 4, marginBottom: 4 }} />
      <Skeleton style={{ width: 28, height: 16, borderRadius: 4 }} />
      <Skeleton style={{ width: 40, height: 12, borderRadius: 4, marginTop: 4 }} />
    </View>
  );
}

function SingleCampaignCardSkeleton({ index, isMobileLayout }: { index: number; isMobileLayout: boolean }) {
  const campaignBlockDesktop = (
    <View className="flex-row gap-3 flex-1 max-w-[35%] min-w-0">
      <View className="mt-0.5">
        <Skeleton style={{ width: 56, height: 56, borderRadius: 28 }} />
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 mb-1 flex-wrap">
          <Skeleton style={{ width: 180, height: 20, borderRadius: 4 }} />
          <Skeleton style={{ width: 72, height: 24, borderRadius: 8 }} />
        </View>
        <Skeleton style={{ width: 220, height: 14, borderRadius: 4, marginBottom: 4 }} />
        <Skeleton style={{ width: 120, height: 12, borderRadius: 4 }} />
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
      <Skeleton style={{ width: 100, height: 32, borderRadius: 8 }} />
      <Skeleton style={{ width: 44, height: 44, borderRadius: 8 }} />
      <Skeleton style={{ width: 44, height: 44, borderRadius: 8 }} />
    </View>
  );

  if (isMobileLayout) {
    return (
      <StaggeredFadeIn index={index}>
        <Card variant="card" className="mb-4">
          {/* Block 1 — Identity (dial 48 + smaller name/pill/date/next) */}
          <View className="flex-row gap-3 mb-3">
            <View className="mt-0.5">
              <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }} />
            </View>
            <View className="flex-1 min-w-0">
              <Skeleton style={{ width: 140, height: 16, borderRadius: 4, marginBottom: 4 }} />
              <Skeleton style={{ width: 100, height: 12, borderRadius: 4, marginBottom: 4 }} />
              <Skeleton style={{ width: 180, height: 12, borderRadius: 4 }} />
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
        </Card>
      </StaggeredFadeIn>
    );
  }

  return (
    <StaggeredFadeIn index={index}>
      <Card variant="card" className="mb-4 relative">
        <View className="flex-row items-start gap-4">
          {campaignBlockDesktop}
          {statsBlockDesktop}
        </View>
        <View className="absolute right-4 top-4">
          {toolsBlock}
        </View>
      </Card>
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
