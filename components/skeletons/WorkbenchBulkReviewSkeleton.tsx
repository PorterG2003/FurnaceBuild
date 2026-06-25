import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

function PreviewHeroSkeleton() {
  return (
    <View className="rounded-xl bg-[#181818] px-4 py-5 gap-2">
      <Skeleton style={{ width: 72, height: 36, borderRadius: 4 }} />
      <Skeleton style={{ width: 96, height: 14, borderRadius: 4 }} />
    </View>
  );
}

function MetricRowSkeleton({ width }: { width?: number | `${number}%` }) {
  return (
    <View className="flex-row items-center justify-between border border-[#2A2A2A] rounded-xl px-3 py-3 bg-[#181818]">
      <Skeleton style={{ width: width ?? 140, height: 14, borderRadius: 4 }} />
      <Skeleton style={{ width: 36, height: 16, borderRadius: 4 }} />
    </View>
  );
}

export function WorkbenchBulkReviewSkeleton({
  metricCount = 5,
  showHero = false,
}: {
  metricCount?: number;
  showHero?: boolean;
}) {
  return (
    <View className="gap-3">
      {showHero ? <PreviewHeroSkeleton /> : null}
      <View className="gap-2">
        {!showHero ? (
          <Skeleton style={{ width: 180, height: 14, borderRadius: 4, marginBottom: 4 }} />
        ) : null}
        {Array.from({ length: metricCount }).map((_, index) => (
          <MetricRowSkeleton key={index} width={index % 2 === 0 ? 148 : 172} />
        ))}
      </View>
    </View>
  );
}
