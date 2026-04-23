import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ImportedRecordRow } from '@/lib/foundry/registry-types';

type Row = ImportedRecordRow & { __key: string };

export function ImportedRecordsTable({
  records,
  loading,
  onRowPress,
  currentPage,
  totalItems,
  onPageChange,
}: {
  records: ImportedRecordRow[];
  loading?: boolean;
  onRowPress?: (item: ImportedRecordRow) => void;
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const items = useMemo(
    (): Row[] => records.map((r) => ({ ...r, __key: r.id })),
    [records],
  );

  const columns = useMemo(
    (): TableColumn<Row>[] => [
      {
        key: 'name',
        label: 'Business',
        flex: 1,
        minWidth: 88,
        render: (item) => (
          <Text className="text-gray-200 font-instrument text-xs" numberOfLines={2}>
            {item.name_raw}
          </Text>
        ),
      },
      {
        key: 'web',
        label: 'Website',
        flex: 0.9,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {item.website ?? '—'}
          </Text>
        ),
      },
      {
        key: 'phone',
        label: 'Phone',
        flex: 0.8,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {item.phone ?? '—'}
          </Text>
        ),
      },
      {
        key: 'addr',
        label: 'Address',
        flex: 1,
        minWidth: 80,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {item.address_raw ?? '—'}
          </Text>
        ),
      },
      {
        key: 'obs',
        label: 'Observed',
        flex: 0.85,
        minWidth: 80,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={1}>
            {item.observed_at?.slice(0, 19).replace('T', ' ') ?? '—'}
          </Text>
        ),
      },
      {
        key: 'link',
        label: 'Link',
        flex: 0.65,
        minWidth: 64,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {item.link_status}
          </Text>
        ),
      },
      {
        key: 'review',
        label: 'Review',
        flex: 0.5,
        minWidth: 56,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={1}>
            {item.review_status}
          </Text>
        ),
      },
      {
        key: 'imp',
        label: 'CSV row',
        flex: 0.5,
        minWidth: 56,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs">
            {item.source_row_number != null ? String(item.source_row_number) : '—'}
          </Text>
        ),
      },
      {
        key: 'nkey',
        label: 'Name key',
        flex: 0.7,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={1}>
            {item.normalized_name_key ?? '—'}
          </Text>
        ),
      },
    ],
    [],
  );

  if (loading) {
    return (
      <View className="py-8">
        <Text className="text-gray-500 font-instrument text-sm text-center">Loading records…</Text>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View className="py-8">
        <Text className="text-gray-500 font-instrument text-sm text-center">No records match this filter.</Text>
      </View>
    );
  }

  return (
    <DataTable<Row>
      items={items}
      columns={columns}
      getItemKey={(item) => item.__key}
      fillAvailableWidth
      pagination
      paginationMode="server"
      currentPage={currentPage}
      totalItems={totalItems}
      onPageChange={onPageChange}
      compactHeader
      equalColumnWidths={false}
      itemsPerPage={25}
      onRowPress={onRowPress ? (item) => onRowPress(item) : undefined}
    />
  );
}
