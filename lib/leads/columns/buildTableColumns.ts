import { createElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TableHeaderLabel, type TableColumn } from '@/components/ui/DataTable';
import { Tooltip } from '@/components/ui/Tooltip';
import { getColumnGroupForSourceType } from './columnCatalog';
import type { LeadsColumnDef, LeadsCellValue } from './types';
import { formatCellValue } from './resolveCellValue';
import { computeColumnStats } from './stats';

/** Column ids supported by account_lead_people_page / saved_lead_list_people_page sort. */
export const SERVER_SORTABLE_COLUMN_IDS = new Set([
  'person-email',
  'person-name',
  'rollup-campaigns',
  'rollup-companies',
  'rollup-reply',
  'rollup-activity',
]);

export type LeadsTableRow = {
  globalLeadId: string;
  cells: Record<string, LeadsCellValue>;
};

export function buildLeadsTableColumns(params: {
  columns: LeadsColumnDef[];
  rows: LeadsTableRow[];
  onMoveLeft?: (columnId: string) => void;
  onMoveRight?: (columnId: string) => void;
  allowColumnReorder?: boolean;
  plainColumnHeaders?: boolean;
}): TableColumn<LeadsTableRow>[] {
  const { columns, rows, onMoveLeft, onMoveRight, allowColumnReorder = true, plainColumnHeaders = false } = params;
  return columns
    .filter((column) => column.visible)
    .map((column, index, visibleColumns) => {
      const stats = computeColumnStats(rows.map((row) => row.cells[column.id] ?? null));
      const label = plainColumnHeaders
        ? createElement(TableHeaderLabel, null, column.label)
        : createElement(
            View,
            { className: 'flex-row items-center gap-2' },
            createElement(TableHeaderLabel, null, column.label),
            createElement(
              Tooltip,
              {
                content: createElement(
                  Text,
                  { className: 'text-white font-instrument text-xs' },
                  `${getColumnGroupForSourceType(column.sourceType)?.label ?? column.sourceLabel}${column.campaignName ? ` · ${column.campaignName}` : ''}`,
                ),
                placement: 'top',
              },
              createElement(Text, { className: 'text-[10px] text-gray-500 font-instrument uppercase' }, 'i'),
            ),
            allowColumnReorder && (onMoveLeft || onMoveRight)
              ? createElement(
                  View,
                  { className: 'flex-row gap-1' },
                  createElement(
                    Pressable,
                    {
                      disabled: !onMoveLeft || index === 0,
                      onPress: () => onMoveLeft?.(column.id),
                    },
                    createElement(
                      Text,
                      { className: `font-instrument text-xs ${index === 0 ? 'text-gray-700' : 'text-gray-400'}` },
                      '←',
                    ),
                  ),
                  createElement(
                    Pressable,
                    {
                      disabled: !onMoveRight || index === visibleColumns.length - 1,
                      onPress: () => onMoveRight?.(column.id),
                    },
                    createElement(
                      Text,
                      {
                        className: `font-instrument text-xs ${index === visibleColumns.length - 1 ? 'text-gray-700' : 'text-gray-400'}`,
                      },
                      '→',
                    ),
                  ),
                )
              : null,
          );
      return {
        key: column.id,
        label,
        minWidth: column.width ?? 180,
        sortable: SERVER_SORTABLE_COLUMN_IDS.has(column.id),
        sortValue: (row) => {
          const value = row.cells[column.id];
          return typeof value === 'boolean' ? (value ? 1 : 0) : ((value as string | number | undefined) ?? '');
        },
        ...(plainColumnHeaders
          ? {}
          : {
              headerStats: {
                filled: stats.filledCount,
                empty: stats.emptyCount,
              },
            }),
        render: (row) =>
          createElement(
            View,
            { className: 'min-w-0 w-full' },
            createElement(
              Text,
              { className: 'text-sm text-white font-instrument', numberOfLines: 2 },
              formatCellValue(column, row.cells[column.id] ?? null),
            ),
          ),
      } satisfies TableColumn<LeadsTableRow>;
    });
}
