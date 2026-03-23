import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ClassifiedRow } from '@/lib/foundry/google-maps-import/validate';

type Row = ClassifiedRow & { __key: string };

export function ImportPreviewTable({ rows }: { rows: ClassifiedRow[] }) {
  const items = useMemo(
    (): Row[] => rows.map((r) => ({ ...r, __key: `r-${r.rowNumber}` })),
    [rows],
  );

  const columns = useMemo(
    (): TableColumn<Row>[] => [
      {
        key: 'row',
        label: 'Row',
        flex: 0.4,
        minWidth: 44,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs">{item.rowNumber}</Text>
        ),
      },
      {
        key: 'name',
        label: 'Name',
        flex: 1,
        minWidth: 80,
        render: (item) => (
          <Text className="text-gray-200 font-instrument text-xs" numberOfLines={2}>
            {item.nameRaw || '—'}
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
            {item.websiteRaw ?? '—'}
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
            {item.addressRaw || '—'}
          </Text>
        ),
      },
      {
        key: 'norm',
        label: 'Normalized site',
        flex: 0.9,
        minWidth: 80,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={1}>
            {item.normalizedWebsitePreview || '—'}
          </Text>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        flex: 0.7,
        minWidth: 64,
        render: (item) => (
          <Text
            className={`font-instrument text-xs ${
              item.status === 'error'
                ? 'text-red-400'
                : item.status === 'warning'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          >
            {item.status === 'valid' ? 'Valid' : item.status === 'warning' ? 'Warning' : 'Error'}
          </Text>
        ),
      },
      {
        key: 'issue',
        label: 'Issue',
        flex: 1.2,
        minWidth: 100,
        render: (item) => (
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={2}>
            {item.issues.join('; ') || '—'}
          </Text>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      items={items}
      columns={columns}
      getItemKey={(item) => item.__key}
      pagination={items.length > 40}
      compactHeader
      equalColumnWidths={false}
      itemsPerPage={40}
    />
  );
}
