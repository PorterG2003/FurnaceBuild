import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/Card';
import { StaggeredFadeIn } from './skeletonUtils';

function SavedListCardSkeleton({ index }: { index: number }) {
  return (
    <StaggeredFadeIn index={index}>
      <Card variant="card">
        <View className="flex-row gap-3 items-start">
          <View className="mt-0.5 items-center" style={{ minWidth: 56 }}>
            <Skeleton style={{ width: 36, height: 28, borderRadius: 4 }} />
            <Skeleton style={{ width: 40, height: 10, borderRadius: 4, marginTop: 4 }} />
          </View>
          <View className="flex-1 min-w-0">
            <Skeleton style={{ width: '68%', height: 18, borderRadius: 4, marginBottom: 8 }} />
            <Skeleton style={{ width: '92%', height: 12, borderRadius: 4, marginBottom: 6 }} />
            <Skeleton style={{ width: '48%', height: 12, borderRadius: 4, marginBottom: 8 }} />
            <Skeleton style={{ width: 120, height: 10, borderRadius: 4 }} />
          </View>
        </View>
      </Card>
    </StaggeredFadeIn>
  );
}

export function SavedLeadListsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <SavedListCardSkeleton key={index} index={index} />
      ))}
    </View>
  );
}
