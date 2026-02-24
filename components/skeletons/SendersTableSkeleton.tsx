import { useEffect, useRef, type ReactNode } from 'react';
import { View, Text, Animated } from 'react-native';
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

/** Checkbox uses circleSize 40, so column needs 40x40 + px-2 = 56px cell. */
const CHECKBOX_CELL_SIZE = 56;

function SkeletonRow({ index, isLast }: { index: number; isLast: boolean }) {
  return (
    <StaggeredFadeIn index={index}>
      <View
        className={`flex-row items-center border-b border-[#2A2A2A] ${isLast ? 'border-b-0' : ''}`}
        style={{ minHeight: CHECKBOX_CELL_SIZE }}
      >
        <View
          className="justify-center items-center"
          style={{ width: CHECKBOX_CELL_SIZE, height: CHECKBOX_CELL_SIZE }}
        >
          <Skeleton style={{ width: 20, height: 20, borderRadius: 4 }} />
        </View>
        <View className="flex-[2] px-2 py-2 justify-center">
          <Skeleton style={{ width: 140, height: 14, borderRadius: 4 }} />
        </View>
        <View className="flex-[2] px-2 py-2 justify-center">
          <Skeleton style={{ width: 180, height: 14, borderRadius: 4 }} />
        </View>
        <View className="flex-[1] px-2 py-2 justify-center">
          <Skeleton style={{ width: 72, height: 22, borderRadius: 6 }} />
        </View>
        <View className="flex-[1] px-2 py-2 justify-center">
          <View className="flex-row gap-1.5">
            <Skeleton style={{ width: 44, height: 28, borderRadius: 6 }} />
            <Skeleton style={{ width: 52, height: 28, borderRadius: 6 }} />
          </View>
        </View>
      </View>
    </StaggeredFadeIn>
  );
}

export function SendersTableSkeleton() {
  const rowCount = 6;

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
      {/* Table Header - matches real table layout */}
      <View
        className="flex-row items-center border-b border-[#2A2A2A] bg-[#1F1F1F]"
        style={{ minHeight: CHECKBOX_CELL_SIZE }}
      >
        <View
          className="justify-center items-center"
          style={{ width: CHECKBOX_CELL_SIZE, height: CHECKBOX_CELL_SIZE }}
        >
          <Skeleton style={{ width: 20, height: 20, borderRadius: 4 }} />
        </View>
        <View className="flex-[2] px-2 py-2 justify-center">
          <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
            Display Name
          </Text>
        </View>
        <View className="flex-[2] px-2 py-2 justify-center">
          <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
            Email Address
          </Text>
        </View>
        <View className="flex-[1] px-2 py-2 justify-center">
          <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
            Status
          </Text>
        </View>
        <View className="flex-[1] px-2 py-2 justify-center">
          <Text className="text-gray-400 font-instrument-semibold text-xs uppercase">
            Actions
          </Text>
        </View>
      </View>

      {Array.from({ length: rowCount }).map((_, i) => (
        <SkeletonRow key={i} index={i} isLast={i === rowCount - 1} />
      ))}
    </View>
  );
}
