import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated, useWindowDimensions } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

const STAT_COLUMN_WIDTH = 72;
const POSITIVE_COLUMN_WIDTH = 88;
const STAT_COLUMN_GAP = 16;
const NARROW_BREAKPOINT = 600;
const STAGGER_DELAY_MS = 60;

function StaggeredFadeIn({ index, children }: { index: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }, index * STAGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [index, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function SingleCampaignCardSkeleton({ index, isNarrow }: { index: number; isNarrow: boolean }) {
  const campaignBlock = (
    <View
      className="flex-row"
      style={{ gap: 12, flex: isNarrow ? undefined : 1, maxWidth: isNarrow ? undefined : '35%', minWidth: 0 }}
    >
      <View style={{ marginTop: 2 }}>
        <Skeleton style={{ width: 56, height: 56, borderRadius: 28 }} />
      </View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center gap-2 mb-1 flex-wrap">
          <Skeleton style={{ width: 180, height: 20, borderRadius: 4 }} />
          <Skeleton style={{ width: 72, height: 24, borderRadius: 8 }} />
        </View>
        <Skeleton style={{ width: 220, height: 14, borderRadius: 4, marginBottom: 4 }} />
        <Skeleton style={{ width: 120, height: 12, borderRadius: 4 }} />
      </View>
    </View>
  );

  const statsBlock = (
    <View
      style={{
        flexDirection: 'row',
        flex: isNarrow ? undefined : 0,
        flexBasis: isNarrow ? undefined : '40%',
        flexShrink: isNarrow ? undefined : 0,
        justifyContent: isNarrow ? 'flex-start' : 'space-around',
        gap: isNarrow ? STAT_COLUMN_GAP : 0,
      }}
    >
      <View style={{ width: STAT_COLUMN_WIDTH, alignItems: 'center' }}>
        <Skeleton style={{ width: 16, height: 16, borderRadius: 4, marginBottom: 4 }} />
        <Skeleton style={{ width: 28, height: 16, borderRadius: 4 }} />
        <Skeleton style={{ width: 40, height: 12, borderRadius: 4, marginTop: 4 }} />
      </View>
      <View style={{ width: STAT_COLUMN_WIDTH, alignItems: 'center' }}>
        <Skeleton style={{ width: 16, height: 16, borderRadius: 4, marginBottom: 4 }} />
        <Skeleton style={{ width: 36, height: 16, borderRadius: 4 }} />
        <Skeleton style={{ width: 48, height: 12, borderRadius: 4, marginTop: 4 }} />
      </View>
      <View style={{ width: POSITIVE_COLUMN_WIDTH, alignItems: 'center' }}>
        <Skeleton style={{ width: 16, height: 16, borderRadius: 4, marginBottom: 4 }} />
        <Skeleton style={{ width: 36, height: 16, borderRadius: 4 }} />
        <Skeleton style={{ width: 72, height: 12, borderRadius: 4, marginTop: 4 }} />
      </View>
    </View>
  );

  const toolsBlock = (
    <View className="flex-row gap-2 items-center">
      <Skeleton style={{ width: 100, height: 32, borderRadius: 8 }} />
      <Skeleton style={{ width: 36, height: 36, borderRadius: 8 }} />
      <Skeleton style={{ width: 36, height: 36, borderRadius: 8 }} />
    </View>
  );

  if (isNarrow) {
    return (
      <StaggeredFadeIn index={index}>
        <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4">
          <View className="flex-row items-start justify-between" style={{ marginBottom: 12 }}>
            {campaignBlock}
            {toolsBlock}
          </View>
          {statsBlock}
        </View>
      </StaggeredFadeIn>
    );
  }

  return (
    <StaggeredFadeIn index={index}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4 mb-4" style={{ position: 'relative' }}>
        <View className="flex-row items-start" style={{ gap: 16 }}>
          {campaignBlock}
          {statsBlock}
        </View>
        <View style={{ position: 'absolute', right: 16, top: 16 }}>
          {toolsBlock}
        </View>
      </View>
    </StaggeredFadeIn>
  );
}

export function CampaignListSkeleton() {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;

  return (
    <View>
      {[0, 1, 2, 3].map((i) => (
        <SingleCampaignCardSkeleton key={i} index={i} isNarrow={isNarrow} />
      ))}
    </View>
  );
}
