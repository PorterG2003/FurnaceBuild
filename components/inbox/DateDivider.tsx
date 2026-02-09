import { View, Text } from 'react-native';

/** Centered date divider with pill-style label */
export function DateDivider({ label }: { label: string }) {
  return (
    <View className="flex-row items-center justify-center py-5 px-2">
      <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
      <View className="mx-3 rounded-full bg-[#1A1A1A] border border-[#2A2A2A] px-4 py-1.5">
        <Text className="text-gray-500 font-instrument-medium text-xs">{label}</Text>
      </View>
      <View className="flex-1 h-px bg-[#2A2A2A]" style={{ maxWidth: 80 }} />
    </View>
  );
}
