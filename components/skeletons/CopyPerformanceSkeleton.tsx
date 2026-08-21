import { View, useWindowDimensions } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { COPY_PIECE_KINDS } from '@/lib/copy/kinds';
import { StaggeredFadeIn } from './skeletonUtils';

const ROW_COUNT = 5;
const TITLE_WIDTHS = [188, 142, 210, 124, 168];
const TAB_WIDTHS: Record<(typeof COPY_PIECE_KINDS)[number], number> = {
  subject: 72,
  hook: 52,
  problem: 80,
  proof: 48,
  offer: 56,
  cta: 42,
};

function KindTabsSkeleton() {
  return (
    <View
      className="flex-row self-start items-center mb-3"
      style={{
        borderWidth: 1,
        borderColor: '#2A2A2A',
        backgroundColor: '#1A1A1A',
        borderRadius: 10,
        padding: 4,
      }}
    >
      {COPY_PIECE_KINDS.map((kind, index) => (
        <View
          key={kind}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: index === 0 ? 'rgba(248, 81, 2, 0.18)' : 'transparent',
          }}
        >
          <Skeleton
            style={{
              width: TAB_WIDTHS[kind],
              height: 14,
              borderRadius: 4,
              opacity: index === 0 ? 0.9 : 0.45,
            }}
          />
        </View>
      ))}
    </View>
  );
}

function KindSelectSkeleton() {
  return (
    <View className="mb-4">
      <Skeleton style={{ width: '100%', height: 44, borderRadius: 12 }} />
    </View>
  );
}

function StatStackSkeleton({ compact }: { compact: boolean }) {
  return (
    <View className="items-center min-w-0" style={{ flex: 1 }}>
      <Skeleton
        style={{
          width: compact ? 12 : 16,
          height: compact ? 12 : 16,
          borderRadius: compact ? 6 : 8,
          marginBottom: compact ? 2 : 4,
        }}
      />
      <Skeleton
        style={{
          width: compact ? 28 : 40,
          height: compact ? 12 : 16,
          borderRadius: 4,
        }}
      />
      <Skeleton
        style={{
          width: compact ? 36 : 52,
          height: compact ? 8 : 10,
          borderRadius: 3,
          marginTop: 4,
        }}
      />
    </View>
  );
}

function CopyRowSkeleton({ index, isMobile }: { index: number; isMobile: boolean }) {
  const titleWidth = TITLE_WIDTHS[index % TITLE_WIDTHS.length]!;
  const title = (
    <View className={isMobile ? undefined : 'flex-1 min-w-0'}>
      <Skeleton
        style={{
          width: isMobile ? Math.min(titleWidth, 220) : titleWidth,
          height: isMobile ? 16 : 18,
          borderRadius: 4,
        }}
      />
      {index % 2 === 0 ? (
        <Skeleton
          style={{
            width: isMobile ? 96 : 112,
            height: 12,
            borderRadius: 4,
            marginTop: 8,
          }}
        />
      ) : null}
    </View>
  );
  const stats = (
    <View className="flex-row items-start" style={isMobile ? undefined : { flexBasis: '56%', flexGrow: 0, flexShrink: 0 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <StatStackSkeleton key={i} compact={isMobile} />
      ))}
    </View>
  );

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl mb-4 overflow-hidden">
      {isMobile ? (
        <View className="p-3.5">
          {title}
          <View className="mt-3">{stats}</View>
        </View>
      ) : (
        <View className="p-4 flex-row items-center gap-4">
          {title}
          {stats}
        </View>
      )}
    </View>
  );
}

export function CopyPerformanceSkeleton() {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <View>
      {isMobile ? <KindSelectSkeleton /> : <KindTabsSkeleton />}
      {Array.from({ length: ROW_COUNT }, (_, index) => (
        <StaggeredFadeIn key={index} index={index}>
          <CopyRowSkeleton index={index} isMobile={isMobile} />
        </StaggeredFadeIn>
      ))}
    </View>
  );
}
