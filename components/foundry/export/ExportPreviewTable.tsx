import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import type { ExportCompanyChainPeopleRow, ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';
import { getExportChainPeopleMergeKey, mergeExportChainPeopleRows } from '@/components/foundry/export/exportChainPeopleMerge';

export interface ExportPreviewRow {
  row_key: string;
  company_id: string;
  company_name: string;
  company_hint: string | null;
  address_text: string | null;
  website: string | null;
  person_name: string | null;
  role_text: string | null;
  linkage_path: string | null;
  registry_state: string;
  registry_entity_id: string | null;
  has_current_linked_source: boolean;
  has_current_owner: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
}

function yn(v: boolean, warn?: boolean) {
  const cls = warn && v ? 'text-red-400/90' : !warn && v ? 'text-emerald-400/80' : 'text-gray-500';
  return (
    <Text className={`font-instrument text-xs ${cls}`} numberOfLines={1}>
      {v ? 'Y' : '—'}
    </Text>
  );
}

function formatAddress(parts: Array<string | null | undefined>): string | null {
  const normalized = parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(', ') : null;
}

export function ownerLeadRowsToPreviewRows(rows: ExportCompanyOwnerLeadRow[]): ExportPreviewRow[] {
  return rows.map((row) => ({
    row_key: `${row.company_entity_match_id}-${row.entity_owner_id ?? 'no-owner'}`,
    company_id: row.company_id,
    company_name: row.legal_name,
    company_hint: row.normalized_key,
    address_text: formatAddress([
      row.address_line_1,
      row.address_line_2,
      row.address_city,
      row.address_state,
      row.address_postal_code,
      row.address_country,
    ]),
    website: row.website,
    person_name: row.owner_name,
    role_text: row.title_role,
    linkage_path: null,
    registry_state: row.registry_state,
    registry_entity_id: row.registry_entity_id,
    has_current_linked_source: row.has_current_linked_source,
    has_current_owner: row.has_current_owner,
    has_open_review_task: row.has_open_review_task,
    has_parse_failure_task: row.has_parse_failure_task,
    is_export_ready: row.is_export_ready,
  }));
}

export function chainPeopleRowsToPreviewRows(
  rows: ExportCompanyChainPeopleRow[],
  mergePeoplePerCompany: boolean,
): ExportPreviewRow[] {
  const sourceRows = mergePeoplePerCompany ? mergeExportChainPeopleRows(rows) : rows;
  return sourceRows.map((row) => ({
    row_key: mergePeoplePerCompany
      ? getExportChainPeopleMergeKey(row)
      : `${row.company_entity_match_id}-${row.person_owner_row_id}-${row.linkage_path}`,
    company_id: row.company_id,
    company_name: row.company_legal_name,
    company_hint: null,
    address_text: formatAddress([
      row.address_line_1,
      row.address_line_2,
      row.address_city,
      row.address_state,
      row.address_postal_code,
      row.address_country,
    ]),
    website: row.website,
    person_name: row.person_name,
    role_text: row.person_title_role,
    linkage_path: row.linkage_path,
    registry_state: row.registry_state,
    registry_entity_id: row.registry_entity_id,
    has_current_linked_source: row.has_current_linked_source,
    has_current_owner: row.has_current_owner,
    has_open_review_task: row.has_open_review_task,
    has_parse_failure_task: row.has_parse_failure_task,
    is_export_ready: row.is_export_ready,
  }));
}

export function ExportPreviewTable({
  rows,
  mode,
  loading,
  onRowPress,
  currentPage,
  totalPages,
  rangeLabel,
  onPageChange,
}: {
  rows: ExportPreviewRow[];
  mode: 'owner_rows' | 'chain_people';
  loading: boolean;
  onRowPress: (row: ExportPreviewRow) => void;
  currentPage: number;
  totalPages: number;
  rangeLabel: string;
  onPageChange: (page: number) => void;
}) {
  const columns = useMemo(
    (): TableColumn<ExportPreviewRow>[] => {
      const baseColumns: TableColumn<ExportPreviewRow>[] = [
        {
          key: 'company',
          label: 'Company',
          flex: 1.15,
          minWidth: 180,
          render: (item) => (
            <View className="min-w-0">
              <Text className="text-white font-instrument text-sm" numberOfLines={2}>
                {item.company_name}
              </Text>
              {item.company_hint ? (
                <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
                  {item.company_hint}
                </Text>
              ) : null}
            </View>
          ),
        },
        {
          key: 'person',
          label: mode === 'chain_people' ? 'Person' : 'Owner',
          flex: 1,
          minWidth: 170,
          render: (item) => (
            <View className="min-w-0">
              <Text className="text-gray-200 font-instrument text-sm" numberOfLines={1}>
                {item.person_name ?? '—'}
              </Text>
              {item.role_text ? (
                <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={2}>
                  {item.role_text}
                </Text>
              ) : null}
            </View>
          ),
        },
        {
          key: 'address',
          label: 'Address',
          flex: 1.2,
          minWidth: 220,
          render: (item) => (
            <Text className="text-gray-400 font-instrument text-xs leading-5" numberOfLines={3}>
              {item.address_text ?? '—'}
            </Text>
          ),
        },
        {
          key: 'website',
          label: 'Website',
          flex: 0.95,
          minWidth: 170,
          render: (item) => (
            <Text className="text-gray-400 font-instrument text-xs leading-5" numberOfLines={2}>
              {item.website ?? '—'}
            </Text>
          ),
        },
      ];

      if (mode === 'chain_people') {
        baseColumns.push({
          key: 'path',
          label: 'Linkage path',
          flex: 1.45,
          minWidth: 260,
          render: (item) => (
            <Text className="text-gray-400 font-instrument text-xs leading-5" numberOfLines={3}>
              {item.linkage_path ?? '—'}
            </Text>
          ),
        });
      }

      baseColumns.push(
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
          flex: 0.9,
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
          label: 'Owner rows',
          minWidth: 76,
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
      );

      return baseColumns;
    },
    [mode],
  );

  return (
    <View>
      <DataTable<ExportPreviewRow>
        items={rows}
        columns={columns}
        getItemKey={(item) => item.row_key}
        loading={loading}
        smoothLoading
        smoothLoadingOptions={{ delayMs: 120, minVisibleMs: 220 }}
        pagination={false}
        compactHeader
        equalColumnWidths={false}
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
