import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { RegistryCompany } from '@/lib/foundry/registry-types';

export function getCompanyDedupeRowKey(company: RegistryCompany): string {
  return company.id;
}

export function useCompanyDedupeColumns(): TableColumn<RegistryCompany>[] {
  return useMemo(
    (): TableColumn<RegistryCompany>[] => [
      {
        key: 'name',
        label: 'Company',
        flex: 1.5,
        minWidth: 180,
        sortable: true,
        sortValue: (company) => company.legal_name.toLowerCase(),
        render: (company) => (
          <View className="min-w-0">
            <Text className="text-white font-instrument text-sm" numberOfLines={2}>
              {company.legal_name}
            </Text>
            {company.normalized_key ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {company.normalized_key}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'notes',
        label: 'Notes',
        flex: 1,
        minWidth: 120,
        sortable: true,
        sortValue: (company) => (company.notes ?? '').toLowerCase(),
        render: (company) => (
          <Text className="text-gray-400 font-instrument text-xs leading-5" numberOfLines={3}>
            {company.notes ?? '—'}
          </Text>
        ),
      },
    ],
    [],
  );
}

export function CompanyDedupeTable({
  rows,
  loading,
  selectedKeys,
  onSelectionChange,
  onRowPress,
  emptyMessage,
  currentPage,
  totalItems,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
}: {
  rows: RegistryCompany[];
  loading?: boolean;
  selectedKeys: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  onRowPress?: (company: RegistryCompany) => void;
  emptyMessage?: string;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
}) {
  const columns = useCompanyDedupeColumns();
  const serverMode =
    currentPage != null && typeof totalItems === 'number' && Number.isFinite(totalItems) && onPageChange != null;

  return (
    <DataTable<RegistryCompany>
      items={rows}
      columns={columns}
      getItemKey={getCompanyDedupeRowKey}
      loading={loading}
      fillAvailableWidth
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
      onRowPress={onRowPress}
      emptyMessage={emptyMessage ?? 'No companies match these filters.'}
    />
  );
}
