import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { LeadsWorkbenchTableSkeleton } from './LeadsWorkbenchTableSkeleton';

export function SavedListDetailSkeleton({
  isMobile = false,
  titleWidth = 180,
  subtitleWidth = 240,
}: {
  isMobile?: boolean;
  titleWidth?: number;
  subtitleWidth?: number;
}) {
  return (
    <View className="gap-6">
      {isMobile ? (
        <Skeleton style={{ width: '92%', height: 12, borderRadius: 4 }} />
      ) : (
        <View className="flex-row items-center justify-end gap-3">
          <Skeleton style={{ width: 72, height: 32, borderRadius: 8 }} />
          <Skeleton style={{ width: 96, height: 32, borderRadius: 8 }} />
          <Skeleton style={{ width: 64, height: 32, borderRadius: 8 }} />
        </View>
      )}

      <View className="gap-2">
        <Skeleton style={{ width: titleWidth, height: isMobile ? 24 : 28, borderRadius: 4 }} />
        <Skeleton style={{ width: subtitleWidth, height: 14, borderRadius: 4 }} />
      </View>

      <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
        <Skeleton style={{ flex: 1, height: 44, borderRadius: 12 }} />
        <Skeleton style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }} />
      </View>

      {!isMobile ? (
        <View className="flex-row items-center justify-between gap-3">
          <Skeleton style={{ width: 140, height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 88, height: 32, borderRadius: 8 }} />
        </View>
      ) : null}

      <LeadsWorkbenchTableSkeleton />
    </View>
  );
}
