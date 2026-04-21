import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { IngestionRunRow, IngestionRunStats } from '@/lib/foundry/registry-types';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';

type Row = IngestionRunRow & { __key: string };

function stat(stats: IngestionRunStats | undefined, key: keyof IngestionRunStats): string {
  const v = stats?.[key];
  return v != null ? String(v) : '—';
}

function importDisplayName(config: Record<string, unknown>): string {
  const n = config?.import_name;
  return typeof n === 'string' && n.trim() ? n.trim() : '—';
}

export function ImportRunTable({
  runs,
  loading,
  currentPage,
  totalItems,
  onPageChange,
}: {
  runs: IngestionRunRow[];
  loading?: boolean;
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const items = useMemo(
    (): Row[] => runs.map((r) => ({ ...r, __key: r.id })),
    [runs],
  );

  const columns = useMemo(
    (): TableColumn<Row>[] => [
      {
        key: 'name',
        label: 'Import name',
        flex: 1.2,
        minWidth: 100,
        render: (item) => (
          <Link href={`/foundry/imports/${item.id}/results`} asChild>
            <Pressable>
              <Text className="text-brand-orange font-instrument text-sm" numberOfLines={1}>
                {importDisplayName(item.config)}
              </Text>
            </Pressable>
          </Link>
        ),
      },
      {
        key: 'source',
        label: 'Source',
        flex: 0.8,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-300 font-instrument text-xs" numberOfLines={1}>
            {item.source_name}
          </Text>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        flex: 0.7,
        minWidth: 72,
        render: (item) => (
          <Text className="text-gray-300 font-instrument text-xs" numberOfLines={1}>
            {item.status}
          </Text>
        ),
      },
      {
        key: 'created',
        label: 'Created',
        flex: 1,
        minWidth: 88,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={1}>
            {item.started_at?.slice(0, 19).replace('T', ' ') ?? '—'}
          </Text>
        ),
      },
      {
        key: 'total',
        label: 'Total',
        flex: 0.5,
        minWidth: 48,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs">{stat(item.stats, 'total_rows')}</Text>
        ),
      },
      {
        key: 'imported',
        label: 'Imported',
        flex: 0.6,
        minWidth: 56,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs">{stat(item.stats, 'imported_rows')}</Text>
        ),
      },
      {
        key: 'failed',
        label: 'Failed',
        flex: 0.5,
        minWidth: 48,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs">
            {stat(item.stats, 'failed_rows')}
          </Text>
        ),
      },
    ],
    [],
  );

  if (loading) {
    return (
      <View className="py-8">
        <Text className="text-gray-500 font-instrument text-sm text-center">Loading imports…</Text>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View className="py-8 border border-[#2A2A2A] rounded-xl bg-[#1A1A1A]">
        <Text className="text-gray-500 font-instrument text-sm text-center px-4">
          No imports yet. Start with New Import.
        </Text>
      </View>
    );
  }

  return (
    <DataTable<Row>
      items={items}
      columns={columns}
      getItemKey={(item) => item.__key}
      widthMode="weighted-fill"
      pagination
      paginationMode="server"
      currentPage={currentPage}
      totalItems={totalItems}
      onPageChange={onPageChange}
      compactHeader
      itemsPerPage={50}
    />
  );
}
