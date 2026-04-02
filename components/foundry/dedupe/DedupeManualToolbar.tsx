import { View, Text, TextInput } from 'react-native';
import { Button } from '@/components/ui/button';

export function DedupeManualToolbar({
  searchLabel,
  searchPlaceholder,
  searchText,
  onSearchTextChange,
  onOpenFilters,
  onRefresh,
  activeFilterCount,
  refreshing,
  resultSummary,
  validationHint,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onOpenFilters: () => void;
  onRefresh: () => void;
  activeFilterCount: number;
  refreshing: boolean;
  resultSummary: string;
  validationHint?: string | null;
}) {
  return (
    <View className="mb-4 gap-3">
      <View className="flex-row flex-wrap gap-3 items-end">
        <View className="flex-1 min-w-[240px]">
          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">{searchLabel}</Text>
          <TextInput
            value={searchText}
            onChangeText={onSearchTextChange}
            placeholder={searchPlaceholder}
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#1A1A1A]"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onPress={onOpenFilters}>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-white font-instrument-semibold text-sm">Filters</Text>
              {activeFilterCount > 0 ? (
                <View className="bg-brand-orange rounded-full min-w-[20px] px-1.5 py-0.5 items-center justify-center">
                  <Text className="text-white font-instrument-semibold text-xs">{activeFilterCount}</Text>
                </View>
              ) : null}
            </View>
          </Button>
          <Button variant="secondary" size="sm" onPress={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </View>
      </View>

      <Text className="text-gray-400 font-instrument text-sm">
        {resultSummary}
        {validationHint ? ` ${validationHint}` : ''}
      </Text>
    </View>
  );
}
