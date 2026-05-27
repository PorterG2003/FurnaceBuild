import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

function TimelineRowSkeleton({ flat, isLast }: { flat?: boolean; isLast?: boolean }) {
  return (
    <View
      className={
        flat
          ? `flex-row gap-3 py-3 ${isLast ? '' : 'border-b border-[#2A2A2A]'}`
          : 'flex-row gap-4 rounded-lg border border-[#2A2A2A] bg-[#181818] px-3 py-3'
      }
    >
      <Skeleton style={{ width: 20, height: 20, borderRadius: 10, marginTop: 2 }} />
      <View className="flex-1 min-w-0">
        <View className="flex-row items-start justify-between mb-2">
          <Skeleton style={{ width: '58%', height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 52, height: 10, borderRadius: 4 }} />
        </View>
        <Skeleton style={{ width: '82%', height: 12, borderRadius: 4, marginBottom: 6 }} />
        {!flat ? (
          <Skeleton style={{ width: '48%', height: 10, borderRadius: 4 }} />
        ) : null}
      </View>
    </View>
  );
}

export function LeadActivityTimelineSkeleton({
  flat = false,
  rowCount = 6,
}: {
  flat?: boolean;
  rowCount?: number;
}) {
  return (
    <View className={flat ? 'gap-0' : 'gap-4'}>
      {Array.from({ length: rowCount }).map((_, index) => (
        <TimelineRowSkeleton
          key={index}
          flat={flat}
          isLast={index === rowCount - 1}
        />
      ))}
    </View>
  );
}
