import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ImportErrorSample } from '@/lib/foundry/registry-types';

type Row = ImportErrorSample & { __key: string };

export function ImportErrorsTable({ samples }: { samples: ImportErrorSample[] }) {
  const items = useMemo(
    (): Row[] => samples.map((s) => ({ ...s, __key: `e-${s.rowNumber}` })),
    [samples],
  );

  const columns = useMemo(
    (): TableColumn<Row>[] => [
      {
        key: 'row',
        label: 'Row',
        flex: 0.35,
        minWidth: 40,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs">{item.rowNumber}</Text>
        ),
      },
      {
        key: 'name',
        label: 'Name',
        flex: 1,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-300 font-instrument text-xs" numberOfLines={1}>
            {item.nameRaw || '—'}
          </Text>
        ),
      },
      {
        key: 'addr',
        label: 'Address',
        flex: 1,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {item.addressRaw || '—'}
          </Text>
        ),
      },
      {
        key: 'issues',
        label: 'Issues',
        flex: 1.5,
        minWidth: 120,
        render: (item) => (
          <Text className="text-red-300 font-instrument text-xs" numberOfLines={3}>
            {item.issues.join('; ')}
          </Text>
        ),
      },
    ],
    [],
  );

  if (items.length === 0) return null;

  return (
    <DataTable<Row>
      items={items}
      columns={columns}
      getItemKey={(item) => item.__key}
      fillAvailableWidth
      pagination={false}
      compactHeader
      equalColumnWidths={false}
      itemsPerPage={50}
    />
  );
}
