import { View, Text } from 'react-native';
import { NoSymbolIcon } from 'react-native-heroicons/outline';

/**
 * In-thread notice when the prospect is on the block list.
 * Width is controlled by the parent (match MessageBubble: full width on mobile list, 92% column on desktop).
 */
export function BlockedThreadCallout({ className }: { className?: string }) {
  return (
    <View
      className={`w-full p-4 border rounded-xl bg-yellow-500/20 border-yellow-500/30 ${className ?? ''}`}
      style={{ borderWidth: 1 }}
    >
      <View className="flex-row items-start gap-3">
        <NoSymbolIcon size={22} color="#FACC15" style={{ marginTop: 2 }} />
        <View className="flex-1 min-w-0">
          <Text className="text-yellow-200 font-instrument-semibold text-base leading-tight">
            On your block list
          </Text>
          <Text className="text-yellow-100/90 font-instrument text-sm leading-snug mt-1.5">
            Automated campaign emails won&apos;t be sent to this contact. You can still reply manually from
            the inbox.
          </Text>
        </View>
      </View>
    </View>
  );
}
