import { View, Text } from 'react-native';

export function CsvImportPreviewHero({
  readyCount,
  subtitle,
  removedHint,
}: {
  readyCount: number;
  subtitle?: string;
  removedHint?: string;
}) {
  return (
    <View className="gap-2">
      <View className="rounded-xl bg-[#181818] px-4 py-5">
        <Text className="text-4xl text-white font-instrument-semibold">{readyCount.toLocaleString()}</Text>
        <Text className="text-sm text-gray-400 font-instrument mt-1">leads ready</Text>
        {subtitle ? (
          <Text className="text-xs text-gray-500 font-instrument mt-2">{subtitle}</Text>
        ) : null}
      </View>
      {removedHint ? (
        <Text className="text-xs text-gray-400 font-instrument px-1">{removedHint}</Text>
      ) : null}
    </View>
  );
}

export default CsvImportPreviewHero;
