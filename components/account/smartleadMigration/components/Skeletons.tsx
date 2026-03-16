import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { DataTable } from '@/components/ui/DataTable';
import type { CampaignRow } from '../types';
import { campaignSelectionColumns } from './tableColumns';

export function MigrationStepIndicatorSkeleton() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {Array.from({ length: 4 }).map((_, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ alignItems: 'center', minWidth: 88 }}>
            <Skeleton style={{ width: 36, height: 36, borderRadius: 18 }} />
            <Skeleton style={{ width: 54, height: 10, borderRadius: 4, marginTop: 8 }} />
          </View>
          {index < 3 && <Skeleton style={{ width: 40, height: 1, borderRadius: 1, marginHorizontal: 8 }} />}
        </View>
      ))}
    </View>
  );
}

export function MigrationBootstrapSkeleton() {
  return (
    <View className="gap-4">
      <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-4">
        <View>
          <Skeleton style={{ width: 148, height: 14, borderRadius: 4, marginBottom: 8 }} />
          <Skeleton style={{ width: '72%', height: 10, borderRadius: 4 }} />
        </View>
        <Skeleton style={{ width: '100%', height: 44, borderRadius: 10 }} />
        <View className="gap-2">
          <Skeleton style={{ width: '96%', height: 12, borderRadius: 4 }} />
          <Skeleton style={{ width: '84%', height: 12, borderRadius: 4 }} />
          <Skeleton style={{ width: '64%', height: 12, borderRadius: 4 }} />
        </View>
      </View>
    </View>
  );
}

export function CampaignSelectionSkeleton() {
  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row items-center justify-between mb-2">
        <Skeleton style={{ width: 220, height: 12, borderRadius: 4 }} />
        <Skeleton style={{ width: 84, height: 20, borderRadius: 6 }} />
      </View>
      <Skeleton style={{ width: '100%', height: 42, borderRadius: 10, marginBottom: 12 }} />
      <View style={{ flex: 1, minHeight: 280 }}>
        <DataTable<CampaignRow>
          items={[]}
          getItemKey={() => 'skeleton'}
          columns={campaignSelectionColumns}
          selectable
          selectedKeys={new Set()}
          pagination
          itemsPerPage={25}
          compactHeader
          loading
        />
      </View>
    </View>
  );
}

export function MigrationProgressSkeleton() {
  return (
    <View className="gap-4" style={{ flex: 1 }}>
      <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Skeleton style={{ width: 170, height: 14, borderRadius: 4, marginBottom: 8 }} />
            <Skeleton style={{ width: 220, height: 10, borderRadius: 4 }} />
          </View>
          <Skeleton style={{ width: 96, height: 28, borderRadius: 999 }} />
        </View>
        <Skeleton style={{ width: '100%', height: 8, borderRadius: 999 }} />
        <View className="gap-1">
          <Skeleton style={{ width: 180, height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 240, height: 10, borderRadius: 4 }} />
        </View>
        <View className="flex-row flex-wrap gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <View key={index}>
              <Skeleton style={{ width: 72, height: 10, borderRadius: 4, marginBottom: 6 }} />
              <Skeleton style={{ width: 54, height: 14, borderRadius: 4 }} />
            </View>
          ))}
        </View>
      </View>

      <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Skeleton style={{ width: 108, height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 88, height: 10, borderRadius: 4 }} />
        </View>
        <View className="gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <View key={index} className="rounded-lg border border-[#232323] bg-[#101010] px-3 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <Skeleton style={{ width: index % 2 === 0 ? 180 : 140, height: 12, borderRadius: 4 }} />
                <Skeleton style={{ width: 72, height: 10, borderRadius: 4 }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
