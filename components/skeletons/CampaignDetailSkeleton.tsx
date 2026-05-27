import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';

export function CampaignDetailSkeleton() {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <View className={isMobile ? 'pt-0' : 'pt-4'}>
      {!isMobile ? (
        <View className="flex-row items-center justify-end gap-2 mb-4">
          <Skeleton style={{ width: 96, height: 32, borderRadius: 8 }} />
          <Skeleton style={{ width: 88, height: 32, borderRadius: 8 }} />
          <Skeleton style={{ width: 112, height: 32, borderRadius: 8 }} />
        </View>
      ) : null}

      <View className={`flex-row gap-4 mb-4 ${isMobile ? 'justify-between' : ''}`}>
        {[0, 1, 2, 3].map((tab) => (
          <Skeleton
            key={tab}
            style={{ width: isMobile ? 64 : tab === 0 ? 56 : 72, height: 14, borderRadius: 4 }}
          />
        ))}
      </View>

      <View className={isMobile ? 'mb-4' : 'bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 mb-4'}>
        <Skeleton style={{ width: 160, height: 18, borderRadius: 4, marginBottom: isMobile ? 12 : 24 }} />

        <View style={{ gap: 24 }}>
          <View>
            <Skeleton style={{ width: 40, height: 10, borderRadius: 4, marginBottom: 8 }} />
            <View className="flex-row flex-wrap gap-2">
              {[0, 1, 2].map((tag) => (
                <Skeleton key={tag} style={{ width: 72, height: 24, borderRadius: 999 }} />
              ))}
            </View>
          </View>

          <View style={{ flexDirection: isMobile ? 'column' : 'row', gap: 24 }}>
            <View style={{ flex: 1, gap: 12 }}>
              {[0, 1, 2].map((row) => (
                <View key={row}>
                  <Skeleton style={{ width: 56, height: 10, borderRadius: 4, marginBottom: 6 }} />
                  <Skeleton style={{ width: row === 0 ? 180 : 140, height: 14, borderRadius: 4 }} />
                </View>
              ))}
            </View>
            <View style={{ flex: 1, gap: 12 }}>
              {[0, 1].map((row) => (
                <View key={row}>
                  <Skeleton style={{ width: 64, height: 10, borderRadius: 4, marginBottom: 6 }} />
                  <Skeleton style={{ width: 120, height: 14, borderRadius: 4 }} />
                </View>
              ))}
            </View>
          </View>

          <Skeleton style={{ width: '100%', height: isMobile ? 180 : 240, borderRadius: 12 }} />

          <View className="flex-row gap-4">
            <Skeleton style={{ width: isMobile ? 120 : 160, height: isMobile ? 120 : 160, borderRadius: 999 }} />
            <View className="flex-1 gap-3 justify-center">
              {[0, 1, 2, 3].map((row) => (
                <View key={row} className="flex-row items-center gap-3">
                  <Skeleton style={{ width: 12, height: 12, borderRadius: 6 }} />
                  <Skeleton style={{ width: `${60 + row * 8}%` as `${number}%`, height: 12, borderRadius: 4 }} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
