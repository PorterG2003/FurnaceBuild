import { useMemo, type ReactNode } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  NoSymbolIcon,
  XCircleIcon,
} from 'react-native-heroicons/outline';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { Tooltip } from '@/components/ui/Tooltip';
import type { CsvBuilderColumnStatus, CsvBuilderColumnRow, CsvBuilderHydratedRow } from '@/lib/foundry/registry-types';

type ItemRow = CsvBuilderHydratedRow & { __key: string };

const CSV_COLUMN_STATUS_COPY: Record<CsvBuilderColumnStatus, { title: string; description: string }> = {
  ready: {
    title: 'Ready',
    description: 'No column job is running. Cell values reflect the source file or the last completed tool output.',
  },
  queued: {
    title: 'Queued',
    description: 'A column job is queued and will start shortly.',
  },
  running: {
    title: 'Running',
    description: 'A tool is actively processing this column.',
  },
  completed: {
    title: 'Completed',
    description: 'The last column job finished successfully.',
  },
  partial: {
    title: 'Partial',
    description: 'The last job finished with some rows skipped or failed.',
  },
  failed: {
    title: 'Failed',
    description: 'The last column job did not complete successfully.',
  },
  cancelled: {
    title: 'Cancelled',
    description: 'The column job was cancelled before completion.',
  },
};

function CsvColumnStatusHeaderIcon({ status }: { status: CsvBuilderColumnStatus }) {
  const copy = CSV_COLUMN_STATUS_COPY[status];
  const tooltipBody = (
    <View>
      <Text className="text-white font-instrument-semibold text-xs">{copy.title}</Text>
      <Text className="text-gray-400 font-instrument text-xs mt-1 max-w-[240px]">{copy.description}</Text>
    </View>
  );

  const color =
    status === 'ready'
      ? '#94a3b8'
      : status === 'queued'
        ? '#eab308'
        : status === 'running'
          ? '#38bdf8'
          : status === 'completed'
            ? '#22c55e'
            : status === 'partial'
              ? '#f59e0b'
              : status === 'failed'
                ? '#ef4444'
                : '#6b7280';

  const icon =
    status === 'ready' ? (
      <CheckCircleIcon size={14} color={color} />
    ) : status === 'queued' ? (
      <ClockIcon size={14} color={color} />
    ) : status === 'running' ? (
      <ArrowPathIcon size={14} color={color} />
    ) : status === 'completed' ? (
      <CheckCircleIcon size={14} color={color} />
    ) : status === 'partial' ? (
      <ExclamationTriangleIcon size={14} color={color} />
    ) : status === 'failed' ? (
      <XCircleIcon size={14} color={color} />
    ) : (
      <NoSymbolIcon size={14} color={color} />
    );

  if (Platform.OS === 'web') {
    return (
      <Tooltip content={tooltipBody} placement="top">
        <View className="shrink-0 p-0.5 -m-0.5" accessibilityRole="image" accessibilityLabel={`Column status: ${copy.title}`}>
          {icon}
        </View>
      </Tooltip>
    );
  }

  return (
    <Pressable
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Column status: ${copy.title}`}
      onPress={() => Alert.alert(copy.title, copy.description)}
      className="shrink-0 p-0.5 -m-0.5"
    >
      {icon}
    </Pressable>
  );
}

function cellText(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

export function CsvBuilderTable({
  columns,
  rows,
  loading = false,
  currentPage = 1,
  totalItems,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
}: {
  columns: CsvBuilderColumnRow[];
  rows: CsvBuilderHydratedRow[];
  loading?: boolean;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
}) {
  const items = useMemo<ItemRow[]>(
    () => rows.map((row) => ({ ...row, __key: row.id })),
    [rows],
  );

  const tableColumns = useMemo<TableColumn<ItemRow>[]>(
    () => [
      {
        key: 'row_number',
        label: 'Row',
        minWidth: 70,
        flex: 0.3,
        sortable: true,
        render: (item) => <Text className="text-gray-400 font-instrument text-xs">{item.row_number}</Text>,
      },
      ...columns.map((column) => {
        const headerActive = sortColumn === column.key;
        const headerLabel: ReactNode = (
          <View className="flex-row items-center gap-1.5 min-w-0 flex-1">
            <Text
              className={`text-xs font-instrument-semibold uppercase flex-shrink ${headerActive ? 'text-white' : 'text-gray-400'}`}
              numberOfLines={1}
            >
              {column.label}
            </Text>
            <CsvColumnStatusHeaderIcon status={column.status} />
          </View>
        );
        return {
          key: column.key,
          label: headerLabel,
          minWidth: 160,
          flex: 1,
          sortable: true,
          render: (item: ItemRow) => (
            <Text className="text-gray-200 font-instrument text-xs" numberOfLines={2}>
              {cellText(item.values[column.key])}
            </Text>
          ),
        };
      }),
    ],
    [columns, sortColumn],
  );

  return (
    <DataTable<ItemRow>
      items={items}
      columns={tableColumns}
      getItemKey={(item) => item.__key}
      loading={loading}
      emptyMessage="No rows available"
      pagination
      itemsPerPage={50}
      compactHeader
      paginationMode={onPageChange ? 'server' : 'client'}
      currentPage={currentPage}
      totalItems={totalItems}
      onPageChange={onPageChange}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
    />
  );
}
