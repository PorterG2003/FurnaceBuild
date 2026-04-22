import { Pressable, Text, View } from 'react-native';
import { DataTable } from '@/components/ui/DataTable';
import type { ExportPresentationMode } from '@/components/foundry/export/exportFilterTypes';
import { getVisibleExportTableColumns } from '@/components/foundry/export/exportColumns';
import type { ExportRow } from '@/components/foundry/export/exportRows';

export function ExportPreviewTable({
  rows,
  mode,
  visibleColumnKeys,
  loading,
  onRowPress,
  currentPage,
  totalPages,
  rangeLabel,
  onPageChange,
}: {
  rows: ExportRow[];
  mode: ExportPresentationMode;
  visibleColumnKeys: string[];
  loading: boolean;
  onRowPress: (row: ExportRow) => void;
  currentPage: number;
  totalPages: number;
  rangeLabel: string;
  onPageChange: (page: number) => void;
}) {
  const columns = getVisibleExportTableColumns(visibleColumnKeys, mode);

  return (
    <View>
      <DataTable<ExportRow>
        items={rows}
        columns={columns}
        getItemKey={(item) => item.row_key}
        loading={loading}
        smoothLoading
        smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
        widthMode="weighted-fill"
        pagination={false}
        compactHeader
        onRowPress={onRowPress}
        emptyMessage="No rows match these filters."
      />
      {rows.length > 0 ? (
        <View className="flex-row items-center justify-between mt-4 pt-4 px-1 border-t border-[#2A2A2A]">
          <Text className="text-gray-400 font-instrument text-sm">{rangeLabel}</Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-gray-400 font-instrument text-sm">
              Page {currentPage} of {totalPages}
            </Text>
            <Pressable
              onPress={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className={`px-4 py-2 rounded-lg border ${
                currentPage <= 1 ? 'border-[#2A2A2A] opacity-50' : 'border-[#3A3A3A] active:opacity-70'
              }`}
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <Text className={`text-sm font-instrument-semibold ${currentPage <= 1 ? 'text-gray-500' : 'text-white'}`}>
                Previous
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className={`px-4 py-2 rounded-lg border ${
                currentPage >= totalPages ? 'border-[#2A2A2A] opacity-50' : 'border-[#3A3A3A] active:opacity-70'
              }`}
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <Text className={`text-sm font-instrument-semibold ${currentPage >= totalPages ? 'text-gray-500' : 'text-white'}`}>
                Next
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
