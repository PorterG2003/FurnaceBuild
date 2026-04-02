import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { RegistryEntityOwnerRow } from '@/lib/foundry/registry-types';

export function getEntityOwnerDedupeRowKey(row: RegistryEntityOwnerRow): string {
  return row.id;
}

export function useEntityOwnerDedupeColumns(): TableColumn<RegistryEntityOwnerRow>[] {
  return useMemo(
    (): TableColumn<RegistryEntityOwnerRow>[] => [
      {
        key: 'owner',
        label: 'Owner',
        flex: 1.4,
        minWidth: 180,
        sortable: true,
        sortValue: (row) => row.owner_name.toLowerCase(),
        render: (row) => (
          <View className="min-w-0">
            <Text className="text-white font-instrument text-sm" numberOfLines={2}>
              {row.owner_name}
            </Text>
            {row.owner_normalized_key ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {row.owner_normalized_key}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'title',
        label: 'Title',
        flex: 1,
        minWidth: 120,
        sortable: true,
        sortValue: (row) => (row.title_role ?? '').toLowerCase(),
        render: (row) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {row.title_role ?? '—'}
          </Text>
        ),
      },
      {
        key: 'names',
        label: 'Parsed name',
        flex: 1,
        minWidth: 120,
        sortable: true,
        sortValue: (row) => `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim().toLowerCase(),
        render: (row) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
          </Text>
        ),
      },
      {
        key: 'current',
        label: 'Current',
        minWidth: 72,
        sortable: true,
        sortValue: (row) => (row.is_current ? 1 : 0),
        render: (row) => (
          <Text className={`font-instrument text-xs ${row.is_current ? 'text-emerald-400/90' : 'text-gray-500'}`}>
            {row.is_current ? 'Yes' : 'No'}
          </Text>
        ),
      },
    ],
    [],
  );
}

export function EntityOwnerDedupeTable({
  rows,
  loading,
  selectedKeys,
  onSelectionChange,
  emptyMessage,
  currentPage,
  totalItems,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
}: {
  rows: RegistryEntityOwnerRow[];
  loading?: boolean;
  selectedKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  emptyMessage?: string;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
}) {
  const columns = useEntityOwnerDedupeColumns();
  const serverMode =
    currentPage != null && typeof totalItems === 'number' && Number.isFinite(totalItems) && onPageChange != null;

  return (
    <DataTable<RegistryEntityOwnerRow>
      items={rows}
      columns={columns}
      getItemKey={getEntityOwnerDedupeRowKey}
      loading={loading}
      pagination={serverMode}
      paginationMode={serverMode ? 'server' : 'client'}
      currentPage={currentPage}
      totalItems={totalItems}
      onPageChange={onPageChange}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      smoothLoading
      smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
      compactHeader
      selectable
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      equalColumnWidths={false}
      itemsPerPage={50}
      emptyMessage={emptyMessage ?? 'No contacts match these filters.'}
    />
  );
}
