import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { formatCount } from '../utils';

interface ReviewSectionPaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  itemCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function ReviewSectionPagination({
  page,
  pageSize,
  totalCount,
  itemCount,
  onPrevious,
  onNext,
}: ReviewSectionPaginationProps) {
  if (totalCount <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(totalCount, page * pageSize + itemCount);
  const canPrevious = page > 0;
  const canNext = page + 1 < totalPages && itemCount > 0;

  return (
    <View className="flex-row items-center justify-between mt-3 px-1">
      <Button variant="secondary" size="sm" onPress={onPrevious} disabled={!canPrevious}>
        Previous
      </Button>

      <Text className="text-xs text-gray-400 font-instrument">
        {start}-{end} of {formatCount(totalCount)}
      </Text>

      <Button variant="secondary" size="sm" onPress={onNext} disabled={!canNext}>
        Next
      </Button>
    </View>
  );
}
