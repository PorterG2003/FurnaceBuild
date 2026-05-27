import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { LeadsWorkbenchTableSkeleton } from './LeadsWorkbenchTableSkeleton';

export function LeadsExplorerSkeleton({ isMobile = false }: { isMobile?: boolean }) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
        <Skeleton style={{ flex: 1, height: 44, borderRadius: 12 }} />
        <Skeleton style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }} />
      </View>

      {!isMobile ? (
        <View className="flex-row items-center justify-between gap-3">
          <Skeleton style={{ width: 160, height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 88, height: 32, borderRadius: 8 }} />
        </View>
      ) : null}

      <LeadsWorkbenchTableSkeleton />
    </View>
  );
}
