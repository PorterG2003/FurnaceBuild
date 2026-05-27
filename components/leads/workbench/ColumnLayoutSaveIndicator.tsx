import { Text, View } from 'react-native';
import type { ColumnLayoutSaveStatus } from '@/lib/leads/columns';

export function ColumnLayoutSaveIndicator({ status }: { status: ColumnLayoutSaveStatus }) {
  if (status === 'idle') return null;

  return (
    <View className="flex-row items-center gap-2">
      {status === 'saving' ? (
        <>
          <View className="w-2 h-2 rounded-full bg-[#FBBF24]" />
          <Text className="text-gray-400 font-instrument text-sm">Saving…</Text>
        </>
      ) : null}
      {status === 'saved' ? (
        <>
          <View className="w-2 h-2 rounded-full bg-brand-orange" />
          <Text className="text-gray-400 font-instrument text-sm">Saved</Text>
        </>
      ) : null}
      {status === 'error' ? (
        <>
          <View className="w-2 h-2 rounded-full bg-red-500" />
          <Text className="text-red-400 font-instrument text-sm">Save failed</Text>
        </>
      ) : null}
    </View>
  );
}
