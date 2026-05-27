import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';

export function MissionControlSkeleton() {
  return (
    <View style={{ padding: 24 }}>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl mb-6 overflow-hidden">
        <View className="flex-row items-center justify-between px-5 pt-5 pb-0">
          <Skeleton style={{ width: 48, height: 18, borderRadius: 4 }} />
          <Skeleton style={{ width: 88, height: 32, borderRadius: 8 }} />
        </View>
        <View style={{ margin: 12, marginTop: 16 }}>
          <Skeleton style={{ width: '100%', height: 300, borderRadius: 8 }} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
        {[0, 1].map((card) => (
          <View
            key={card}
            className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-5"
            style={{ flex: 1, height: 200, justifyContent: 'space-between' }}
          >
            <View>
              <View className="flex-row items-center justify-between mb-3">
                <Skeleton style={{ width: card === 0 ? 72 : 80, height: 18, borderRadius: 4 }} />
                <Skeleton style={{ width: 72, height: 20, borderRadius: 6 }} />
              </View>
              <Skeleton style={{ width: '88%', height: 14, borderRadius: 4, marginBottom: 8 }} />
              <Skeleton style={{ width: '64%', height: 14, borderRadius: 4 }} />
            </View>
            <Skeleton style={{ width: 100, height: 32, borderRadius: 8 }} />
          </View>
        ))}
      </View>
    </View>
  );
}
