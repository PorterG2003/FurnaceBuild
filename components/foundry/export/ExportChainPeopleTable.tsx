import { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ExportCompanyChainPeopleRow } from '@/lib/foundry/registry-types';

export function getExportChainPeopleRowKey(row: ExportCompanyChainPeopleRow): string {
  return `${row.company_entity_match_id}-${row.person_owner_row_id}-${row.linkage_path}`;
}

export function ExportChainPeopleTable({
  rows,
  loading,
  onRowPress,
  currentPage,
  totalTargets,
  onPageChange,
}: {
  rows: ExportCompanyChainPeopleRow[];
  loading: boolean;
  onRowPress: (row: ExportCompanyChainPeopleRow) => void;
  currentPage: number;
  totalTargets: number;
  onPageChange: (page: number) => void;
}) {
  const columns = useMemo(
    (): TableColumn<ExportCompanyChainPeopleRow>[] => [
      {
        key: 'company',
        label: 'Company',
        flex: 1,
        minWidth: 180,
        render: (item) => (
          <View className="min-w-0">
            <Text className="text-white font-instrument text-sm" numberOfLines={2}>
              {item.company_legal_name}
            </Text>
            <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
              {item.registry_state}
              {item.registry_entity_id ? ` · ${item.registry_entity_id}` : ''}
            </Text>
          </View>
        ),
      },
      {
        key: 'person',
        label: 'Person',
        flex: 0.9,
        minWidth: 160,
        render: (item) => (
          <View className="min-w-0">
            <Text className="text-gray-200 font-instrument text-sm" numberOfLines={1}>
              {item.person_name}
            </Text>
            {(item.person_title_role || item.person_first_name || item.person_last_name) ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {item.person_title_role ?? [item.person_first_name, item.person_last_name].filter(Boolean).join(' ') || '—'}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'path',
        label: 'Linkage path',
        flex: 1.8,
        minWidth: 320,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs leading-5" numberOfLines={3}>
            {item.linkage_path}
          </Text>
        ),
      },
    ],
    [],
  );

  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalTargets) / 50));

  return (
    <View>
      <DataTable<ExportCompanyChainPeopleRow>
        items={rows}
        columns={columns}
        getItemKey={getExportChainPeopleRowKey}
        loading={loading}
        smoothLoading
        smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
        pagination={false}
        compactHeader
        equalColumnWidths={false}
        onRowPress={onRowPress}
        emptyMessage="No chain-linked people match these filters."
      />
      {totalTargets > 0 ? (
        <View className="flex-row items-center justify-between mt-4 pt-4 px-1 border-t border-[#2A2A2A]">
          <Text className="text-gray-400 font-instrument text-sm">
            Page {currentPage} of {totalPages}
          </Text>
          <View className="flex-row items-center gap-2">
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
