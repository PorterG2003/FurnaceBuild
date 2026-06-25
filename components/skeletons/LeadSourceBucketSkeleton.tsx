import { View } from 'react-native';
import { Skeleton } from '@/components/ui/feedback';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';

type BucketTableRow = Record<string, string> & { __rowKey: string };

const PLACEHOLDER_FIELD_KEYS = [
  'email',
  'name',
  'company_name',
  'first_name',
  'last_name',
  'website',
] as const;

const INSIGHTS_COLUMN_MIN_WIDTH = 160;
const INSIGHTS_COLUMN_MAX_WIDTH = 240;

const PLACEHOLDER_COLUMNS: TableColumn<BucketTableRow>[] = PLACEHOLDER_FIELD_KEYS.map((fieldKey) => ({
  key: fieldKey,
  label: fieldKey,
  flex: 0,
  minWidth: INSIGHTS_COLUMN_MIN_WIDTH,
  maxWidth: INSIGHTS_COLUMN_MAX_WIDTH,
  headerStats: { filled: 1, empty: 1 },
  render: () => null,
}));

export function LeadSourceBucketSkeleton() {
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <View className="flex-1 min-w-0 gap-2">
          <Skeleton style={{ width: 160, height: 14, borderRadius: 4 }} />
          <Skeleton style={{ width: 280, height: 12, borderRadius: 4 }} />
        </View>
        <Skeleton style={{ width: 132, height: 36, borderRadius: 8 }} />
      </View>

      <DataTable
        items={[]}
        columns={PLACEHOLDER_COLUMNS}
        getItemKey={() => ''}
        itemsPerPage={20}
        loading
        smoothLoading={false}
        paginationMode="server"
      />
    </View>
  );
}
