import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/Card';

function MetricCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <Card variant="card" className={compact ? 'w-full p-4' : 'flex-1 min-w-0 p-4'}>
      <View className="flex-row items-center gap-2 mb-2">
        <Skeleton style={{ width: compact ? 28 : 32, height: compact ? 28 : 32, borderRadius: 8 }} />
        <Skeleton style={{ width: 100, height: 14, borderRadius: 4 }} />
      </View>
      <Skeleton style={{ width: '80%', height: 10, borderRadius: 4, marginBottom: 12 }} />
      <Skeleton style={{ width: 48, height: compact ? 24 : 28, borderRadius: 4 }} />
    </Card>
  );
}

function ProfileSectionSkeleton() {
  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
      <View className="gap-5">
        <View>
          <Skeleton style={{ width: 120, height: 18, borderRadius: 4, marginBottom: 8 }} />
          <Skeleton style={{ width: 220, height: 12, borderRadius: 4 }} />
        </View>
        <View className="gap-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <View key={row} className="gap-2">
              <Skeleton style={{ width: 72, height: 10, borderRadius: 4 }} />
              <Skeleton style={{ width: '100%', height: 40, borderRadius: 8 }} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function MobileHubSkeleton() {
  return (
    <View className="gap-3">
      {[0, 1, 2, 3].map((index) => (
        <Card key={index} variant="card" className="p-4">
          <View className="flex-row items-center gap-3">
            <Skeleton style={{ width: 22, height: 22, borderRadius: 6 }} />
            <Skeleton style={{ width: 120, height: 16, borderRadius: 4, flex: 1 }} />
            <Skeleton style={{ width: 20, height: 20, borderRadius: 4 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function LeadDetailSkeleton({ isMobile = false }: { isMobile?: boolean }) {
  if (isMobile) {
    return <MobileHubSkeleton />;
  }

  return (
    <View className="gap-4 pt-1">
      <View className="flex-row gap-4 w-full">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </View>

      <View className="flex-row gap-6 border-b border-[#2A2A2A] pb-3">
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton key={tab} style={{ width: tab === 0 ? 72 : 88, height: 14, borderRadius: 4 }} />
        ))}
      </View>

      <ProfileSectionSkeleton />
    </View>
  );
}
