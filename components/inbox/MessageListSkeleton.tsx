import { useEffect, useRef, type ReactNode } from 'react';
import { View, ScrollView, Animated } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import type { DimensionValue } from 'react-native';

const SKELETON_DELAY_MS = 200;
const SKELETON_MIN_DISPLAY_MS = 300;
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
        useNativeDriver: true,
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
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
    >
      {THREAD_SKELETON_WIDTHS.map(([w1, w2, w3], i) => (
        <StaggeredFadeIn key={i} index={i}>
          <View
            className="mx-3 mb-2 rounded-xl border border-[#2A2A2A] px-4 py-3"
            style={{ borderWidth: 1 }}
          >
            <Skeleton style={{ width: w1, height: 16, borderRadius: 4 }} />
            <Skeleton style={{ width: w2, height: 12, borderRadius: 4, marginTop: 4 }} />
            <Skeleton style={{ width: w3, height: 12, borderRadius: 4, marginTop: 8 }} />
          </View>
        </StaggeredFadeIn>
      ))}
    </ScrollView>
  );
}

function MessagePanelHeaderSkeleton() {
  return (
    <View
      className="px-5 py-4 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <Skeleton style={{ width: 240, height: 24, borderRadius: 4 }} />
      <View className="mt-3 gap-0">
        <View className="flex-row items-center gap-3 py-1.5">
          <Skeleton style={{ width: 64, height: 20, borderRadius: 4 }} />
          <Skeleton style={{ width: 160, height: 16, borderRadius: 4 }} />
        </View>
        <View className="flex-row items-center gap-3 py-1.5">
          <Skeleton style={{ width: 72, height: 20, borderRadius: 4 }} />
          <Skeleton style={{ width: 140, height: 16, borderRadius: 4 }} />
        </View>
      </View>
    </View>
  );
}

function DateDividerSkeleton({ index }: { index: number }) {
  return (
    <StaggeredFadeIn index={index}>
      <View className="py-5 flex-row items-center justify-center px-2">
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
        <View className="mx-3">
          <Skeleton style={{ width: 100, height: 24, borderRadius: 12 }} />
        </View>
        <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
      </View>
    </StaggeredFadeIn>
  );
}

function MessageCardSkeleton({
  bodyWidths,
  index,
}: {
  bodyWidths: DimensionValue[];
  index: number;
}) {
  return (
    <StaggeredFadeIn index={index}>
      <View
        className="mb-4 rounded-xl overflow-hidden border border-[#2A2A2A]"
        style={{
          width: '92%',
          alignSelf: 'center',
          borderWidth: 1,
          backgroundColor: '#1A1A1A',
        }}
      >
        <View className="px-5 pt-4 pb-3 flex-row items-center">
          <Skeleton style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View className="ml-3 flex-1">
            <Skeleton className="h-4 mb-1.5" style={{ width: '70%', borderRadius: 4 }} />
            <Skeleton className="h-3" style={{ width: '52%', borderRadius: 4 }} />
          </View>
          <Skeleton className="h-3 flex-shrink-0" style={{ width: 72, borderRadius: 4 }} />
        </View>
        <View className="mx-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }} />
        <View className="px-5 py-4">
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
      </View>
    </StaggeredFadeIn>
  );
}

/** Skeleton loading for message list (right panel). Only shown after 200ms delay. */
export function MessageListSkeleton() {
  return (
    <ScrollView
      className="flex-1 bg-[#121212]"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <DateDividerSkeleton index={0} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[0]} index={1} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[1]} index={2} />
      <DateDividerSkeleton index={3} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[2]} index={4} />
      <MessageCardSkeleton bodyWidths={MESSAGE_BODY_WIDTHS[3]} index={5} />
    </ScrollView>
  );
}

export { MessagePanelHeaderSkeleton, SKELETON_DELAY_MS, SKELETON_MIN_DISPLAY_MS };
