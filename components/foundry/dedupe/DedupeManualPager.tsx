import { View, Text } from 'react-native';
import { Button } from '@/components/ui/button';

export function DedupeManualPager({
  page,
  pageSize,
  totalCount,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = totalCount === 0 ? 0 : Math.min(totalCount, page * pageSize);
  const canGoPrev = page > 1;
  const canGoNext = page < pageCount && to < totalCount;

  return (
    <View className="mt-4 flex-row flex-wrap items-center justify-between gap-3">
      <Text className="text-gray-400 font-instrument text-sm">
        Showing {from}-{to} of {totalCount}
      </Text>
      <View className="flex-row items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!canGoPrev} onPress={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Text className="text-gray-400 font-instrument text-sm">
          Page {page} of {pageCount}
        </Text>
        <Button variant="secondary" size="sm" disabled={!canGoNext} onPress={() => onPageChange(page + 1)}>
          Next
        </Button>
      </View>
    </View>
  );
}
