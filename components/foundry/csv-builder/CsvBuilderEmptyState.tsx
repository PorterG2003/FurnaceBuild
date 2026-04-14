import { View, Text } from 'react-native';

export function CsvBuilderEmptyState() {
  return (
    <View className="border border-dashed border-[#3A3A3A] rounded-xl p-8 bg-[#161616] items-center">
      <Text className="text-white font-instrument-semibold text-lg mb-2">Start a CSV Builder run</Text>
      <Text className="text-gray-400 font-instrument text-sm text-center max-w-[520px] leading-6">
        Upload a CSV, preview it in a Foundry workspace, and add enrichment columns without turning it into a reusable
        ingestion run.
      </Text>
    </View>
  );
}
