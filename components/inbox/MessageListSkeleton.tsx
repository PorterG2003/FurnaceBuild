import { useEffect, useRef, type ReactNode } from 'react';
import { View, ScrollView, Animated } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { SKELETON_DELAY_MS, SKELETON_MIN_DISPLAY_MS } from '@/components/ui/feedback/skeletonConstants';
import type { DimensionValue } from 'react-native';

export type MessageListSkeletonVariant = 'desktop' | 'mobile';

export type MessageListSkeletonProps = {
  variant?: MessageListSkeletonVariant;
};

const useNativeDriver = typeof window === 'undefined';
const STAGGER_DELAY_MS = 60;

/** Per-item width variations (pixels) for a more organic skeleton look. */
const THREAD_SKELETON_WIDTHS: [number, number, number][] = [
  [280, 220, 160],
  [260, 200, 140],
  [290, 180, 120],
  [250, 210, 155],
  [270, 230, 135],
  [255, 195, 170],
  [285, 240, 125],
  [265, 205, 150],
];

/** Body line widths per message card (percentage) for varied skeleton appearance. */
const MESSAGE_BODY_WIDTHS: DimensionValue[][] = [
  ['100%', '94%', '78%'],
  ['98%', '88%', '72%', '55%'],
  ['100%', '90%', '70%'],
  ['96%', '82%', '65%'],
];

/** Wrapper that fades in children with a staggered delay based on index. */
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

/** Skeleton loading for thread list (left panel). Only shown after 200ms delay. */
export function ThreadListSkeleton() {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingTop: 0, paddingBottom: 8 }}
      showsVerticalScrollIndicator={false}
    >
      {THREAD_SKELETON_WIDTHS.map(([w1, w2, w3], i) => (
        <StaggeredFadeIn key={i} index={i}>
          <View
            className="mx-3 mb-1.5 rounded-xl border border-[#2A2A2A] px-3 py-2.5"
            style={{ borderWidth: 1 }}
          >
            <View className="flex-row justify-between mb-1">
              <Skeleton style={{ width: 100, height: 12, borderRadius: 4 }} />
              <Skeleton style={{ width: 72, height: 18, borderRadius: 10 }} />
            </View>
            <Skeleton style={{ width: w1, height: 16, borderRadius: 4 }} />
            <Skeleton style={{ width: w2, height: 12, borderRadius: 4, marginTop: 4 }} />
            <Skeleton style={{ width: 120, height: 18, borderRadius: 6, marginTop: 6 }} />
          </View>
        </StaggeredFadeIn>
      ))}
    </ScrollView>
  );
}

function MessagePanelHeaderSkeleton() {
  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-center justify-between gap-3">
        {/* Left: name + email (tight between) */}
        <View className="flex-1 min-w-0">
          <Skeleton style={{ height: 20, borderRadius: 4, marginBottom: 2, maxWidth: 200 }} />
          <Skeleton style={{ height: 14, borderRadius: 4, maxWidth: 260 }} />
        </View>
        {/* Right: toolbar */}
        <View className="flex-row items-center gap-2 flex-shrink-0">
          <Skeleton style={{ width: 48, height: 24, borderRadius: 6 }} />
          <Skeleton style={{ width: 72, height: 24, borderRadius: 6 }} />
          <Skeleton style={{ width: 100, height: 28, borderRadius: 8 }} />
          <Skeleton style={{ width: 56, height: 28, borderRadius: 8 }} />
        </View>
      </View>
    </View>
  );
}

function DateDividerSkeleton({ index, compact }: { index: number; compact?: boolean }) {
  return (
    <StaggeredFadeIn index={index}>
      <View className={`${compact ? 'py-3' : 'py-5'} flex-row items-center justify-center px-2`}>
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
        <View className="mx-3">
          <Skeleton style={{ width: compact ? 88 : 100, height: compact ? 20 : 24, borderRadius: 12 }} />
        </View>
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
      </View>
    </StaggeredFadeIn>
  );
}

function MessageCardSkeleton({
  bodyWidths,
  index,
  variant = 'desktop',
}: {
  bodyWidths: DimensionValue[];
  index: number;
  variant?: MessageListSkeletonVariant;
}) {
  const mobile = variant === 'mobile';
  const hPad = mobile ? 'px-4' : 'px-5';
  const mxRule = mobile ? 'mx-4' : 'mx-5';
  const cardInner = (
    <>
      <View className={`${hPad} pt-4 pb-3 flex-row items-center`}>
        <Skeleton style={{ width: 40, height: 40, borderRadius: 20 }} />
        <View className="ml-3 flex-1 min-w-0">
          <Skeleton className="h-4 mb-1.5" style={{ width: '70%', borderRadius: 4 }} />
          <Skeleton className="h-3" style={{ width: '52%', borderRadius: 4 }} />
        </View>
        {mobile ? (
          <Skeleton style={{ width: 20, height: 20, borderRadius: 10 }} className="flex-shrink-0 ml-2" />
        ) : (
          <Skeleton className="h-3 flex-shrink-0" style={{ width: 72, borderRadius: 4 }} />
        )}
      </View>
      <View className={`${mxRule} border-b border-[#2A2A2A]`} style={{ borderBottomWidth: 1 }} />
      <View className={`${hPad} py-4`}>
        {bodyWidths.map((w, j) => (
          <Skeleton
            key={j}
            style={{
              width: w,
              height: 12,
              borderRadius: 4,
              marginBottom: j < bodyWidths.length - 1 ? 8 : 0,
            }}
          />
        ))}
      </View>
    </>
  );

  return (
    <StaggeredFadeIn index={index}>
      {mobile ? (
        <View className="mb-3 w-full">
          <View
            className="rounded-xl w-full overflow-hidden border border-[#2A2A2A]"
            style={{ borderWidth: 1, backgroundColor: '#1A1A1A' }}
          >
            {cardInner}
          </View>
        </View>
      ) : (
        <View
          className="mb-4 rounded-xl overflow-hidden border border-[#2A2A2A]"
          style={{
            width: '92%',
            alignSelf: 'center',
            borderWidth: 1,
            backgroundColor: '#1A1A1A',
          }}
        >
          {cardInner}
        </View>
      )}
    </StaggeredFadeIn>
  );
}

/** Skeleton loading for message list (right panel). Use `variant="mobile"` for inbox overflow-sheet layout (no desktop toolbar chrome). */
export function MessageListSkeleton({ variant = 'desktop' }: MessageListSkeletonProps) {
  const mobile = variant === 'mobile';
  return (
    <ScrollView
      className="flex-1 bg-[#121212]"
      contentContainerStyle={{
        paddingHorizontal: mobile ? 0 : 24,
        paddingTop: mobile ? 8 : 20,
        paddingBottom: mobile ? 0 : 32,
      }}
      showsVerticalScrollIndicator={false}
    >
      <DateDividerSkeleton index={0} compact={mobile} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[0]} index={1} variant={variant} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[1]} index={2} variant={variant} />
      <DateDividerSkeleton index={3} compact={mobile} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[2]} index={4} variant={variant} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[3]} index={5} variant={variant} />
    </ScrollView>
  );
}

export { MessagePanelHeaderSkeleton, SKELETON_DELAY_MS, SKELETON_MIN_DISPLAY_MS };
