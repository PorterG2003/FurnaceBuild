import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/Card';
import { StaggeredFadeIn } from './skeletonUtils';

function MobileLeadCardSkeleton({ index }: { index: number }) {
  return (
    <StaggeredFadeIn index={index}>
      <Card variant="card">
        <Skeleton style={{ width: '72%', height: 16, borderRadius: 4, marginBottom: 12 }} />
        {[0, 1, 2].map((row) => (
          <View key={row} className="gap-1 mt-2">
            <Skeleton style={{ width: 64, height: 10, borderRadius: 4 }} />
            <Skeleton style={{ width: row === 0 ? '88%' : row === 1 ? '64%' : '48%', height: 14, borderRadius: 4 }} />
          </View>
        ))}
      </Card>
    </StaggeredFadeIn>
  );
}

export function LeadsWorkbenchTableSkeleton({ cardCount = 5 }: { cardCount?: number }) {
  return (
    <View className="gap-4">
      {Array.from({ length: cardCount }).map((_, index) => (
        <MobileLeadCardSkeleton key={index} index={index} />
      ))}
    </View>
  );
}
