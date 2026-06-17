import { View, Text } from 'react-native';
import { ArrowPathIcon } from 'react-native-heroicons/outline';

/**
 * In-thread notice when an automated reply is still being categorized or armed.
 * Width is controlled by the parent (match MessageBubble: full width on mobile list, 92% column on desktop).
 */
export function AutoReplyPipelineCallout({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <View
      className={`w-full p-4 border rounded-xl bg-sky-500/15 border-sky-500/30 ${className ?? ''}`}
      style={{ borderWidth: 1 }}
    >
      <View className="flex-row items-start gap-3">
        <ArrowPathIcon size={22} color="#7DD3FC" style={{ marginTop: 2 }} />
        <View className="flex-1 min-w-0">
          <Text className="text-sky-100 font-instrument-semibold text-base leading-tight">
            Automated reply in progress
          </Text>
          <Text className="text-sky-100/90 font-instrument text-sm leading-snug mt-1.5">
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}
