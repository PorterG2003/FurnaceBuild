import { View, Text } from 'react-native';

export function SourceLinkAdjudicationExplainer({ variant }: { variant: 'full' | 'compact' }) {
  if (variant === 'compact') {
    return (
      <View className="mb-3 p-2 rounded-md border border-[#2A2A2A] bg-[#121212]">
        <Text className="text-gray-400 font-instrument text-xs leading-5">
          This task is about one imported source row (below). The suggestions are existing companies already in your
          registry—scores reflect name/key similarity. Your job is to link this import to at most one company, or create
          a new company if none match.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#121212]">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">What you are doing</Text>
      <Text className="text-gray-300 font-instrument text-sm leading-6">
        A <Text className="text-gray-200 font-instrument-semibold">source record</Text> is one business row from an import
        (your file or connector). It is not yet a canonical company by itself.
      </Text>
      <Text className="text-gray-300 font-instrument text-sm leading-6 mt-2">
        The list below (when present) shows <Text className="text-gray-200 font-instrument-semibold">companies that already exist</Text>{' '}
        in your registry. The system ranked them by similarity to this import. Choosing &quot;Link to this company&quot;
        connects <Text className="text-gray-200 font-instrument-semibold">this import</Text> to{' '}
        <Text className="text-gray-200 font-instrument-semibold">one</Text> registry company.
      </Text>
    </View>
  );
}
