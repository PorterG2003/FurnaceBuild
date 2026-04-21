import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';

function yn(v: boolean, warn?: boolean) {
  const cls = warn && v ? 'text-red-400/90' : !warn && v ? 'text-emerald-400/80' : 'text-gray-500';
  return (
    <Text className={`font-instrument text-xs ${cls}`} numberOfLines={1}>
      {v ? 'Y' : '—'}
    </Text>
  );
}

export function getExportLeadRowKey(row: ExportCompanyOwnerLeadRow): string {
  return `${row.company_entity_match_id}-${row.entity_owner_id ?? 'no-owner'}`;
}

export function ExportLeadsTable({
  rows,
  loading,
  onRowPress,
  selectable,
  selectedKeys,
  onSelectionChange,
  currentPage,
  totalItems,
  onPageChange,
}: {
  rows: ExportCompanyOwnerLeadRow[];
  loading: boolean;
  onRowPress: (row: ExportCompanyOwnerLeadRow) => void;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const columns = useMemo(
    (): TableColumn<ExportCompanyOwnerLeadRow>[] => [
      {
        key: 'company',
        label: 'Company',
        flex: 1.4,
        minWidth: 160,
        render: (item) => (
          <View className="min-w-0">
            <Text className="text-white font-instrument text-sm" numberOfLines={2}>
              {item.legal_name}
            </Text>
            {item.normalized_key ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {item.normalized_key}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'owner',
        label: 'Owner',
        flex: 1.1,
        minWidth: 140,
        render: (item) => (
          <View className="min-w-0">
            <Text className="text-gray-300 font-instrument text-sm" numberOfLines={1}>
              {item.owner_name ?? '—'}
            </Text>
            {item.title_role ? (
              <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {item.title_role}
              </Text>
            ) : null}
          </View>
        ),
      },
      {
        key: 'ready',
        label: 'Ready',
        minWidth: 72,
        render: (item) =>
          item.is_export_ready ? (
            <Text className="text-emerald-400/90 font-instrument text-xs">Ready</Text>
          ) : (
            <Text className="text-gray-500 font-instrument text-xs">No</Text>
          ),
      },
      {
        key: 'registry',
        label: 'State / entity',
        flex: 1,
        minWidth: 120,
        render: (item) => (
          <Text className="text-gray-400 font-instrument text-xs" numberOfLines={2}>
            {item.registry_state}
            {item.registry_entity_id ? `\n${item.registry_entity_id}` : ''}
          </Text>
        ),
      },
      {
        key: 'linked',
        label: 'Linked',
        minWidth: 56,
        render: (item) => yn(item.has_current_linked_source),
      },
      {
        key: 'ownerRow',
        label: 'Owner row',
        minWidth: 72,
        render: (item) => yn(item.has_current_owner),
      },
      {
        key: 'review',
        label: 'Review',
        minWidth: 56,
        render: (item) => yn(item.has_open_review_task, true),
      },
      {
        key: 'parse',
        label: 'Parse',
        minWidth: 48,
        render: (item) => yn(item.has_parse_failure_task, true),
      },
    ],
    [],
  );

  return (
    <DataTable<ExportCompanyOwnerLeadRow>
      items={rows}
      columns={columns}
      getItemKey={getExportLeadRowKey}
      loading={loading}
      smoothLoading
      smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
      widthMode="weighted-fill"
      pagination
      paginationMode="server"
      currentPage={currentPage}
      totalItems={totalItems}
      onPageChange={onPageChange}
      compactHeader
      itemsPerPage={50}
      onRowPress={onRowPress}
      emptyMessage="No rows match these filters."
      selectable={selectable}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
    />
  );
}
