import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

function MetricRowSkeleton({ width }: { width?: number | `${number}%` }) {
  return (
    <View className="flex-row items-center justify-between border border-[#2A2A2A] rounded-xl px-3 py-3 bg-[#181818]">
      <Skeleton style={{ width: width ?? 140, height: 14, borderRadius: 4 }} />
      <Skeleton style={{ width: 36, height: 16, borderRadius: 4 }} />
    </View>
  );
}

export function WorkbenchBulkReviewSkeleton({ metricCount = 5 }: { metricCount?: number }) {
  return (
    <View className="gap-2">
      <Skeleton style={{ width: 180, height: 14, borderRadius: 4, marginBottom: 4 }} />
      {Array.from({ length: metricCount }).map((_, index) => (
        <MetricRowSkeleton key={index} width={index % 2 === 0 ? 148 : 172} />
      ))}
    </View>
  );
}
