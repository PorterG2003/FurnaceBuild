import { useMemo } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState, useSmoothLoading } from '@/components/ui/feedback';
import { LeadsWorkbenchTableSkeleton } from '@/components/skeletons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { buildLeadsTableColumns, type LeadsColumnDef, type LeadsTableRow } from '@/lib/leads/columns';

function WorkbenchTableSkeleton({
  isMobile,
  tableColumns,
  selectable,
  selectedKeys,
  onSelectionChange,
  selectAllScope,
  pagination,
  paginationMode,
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
}: {
  isMobile: boolean;
  tableColumns: ReturnType<typeof buildLeadsTableColumns>;
  selectable: boolean;
  selectedKeys: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  selectAllScope: 'page' | 'all';
  pagination: boolean;
  paginationMode: 'client' | 'server';
  currentPage?: number;
  totalItems?: number;
  itemsPerPage: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
}) {
  if (isMobile) {
    return <LeadsWorkbenchTableSkeleton />;
  }

  return (
    <DataTable
      items={[]}
      getItemKey={() => ''}
      columns={tableColumns}
      selectable={selectable}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      selectAllScope={selectAllScope}
      pagination={pagination}
      paginationMode={paginationMode}
      currentPage={currentPage}
      totalItems={totalItems}
      itemsPerPage={itemsPerPage}
      onPageChange={onPageChange}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      widthMode="content-aware"
      loading
      smoothLoading={false}
    />
  );
}

export function LeadsWorkbenchTable({
  rows,
  columns,
  selectedKeys,
  onSelectionChange,
  onFetchViewKeys,
  onMoveColumnLeft,
  onMoveColumnRight,
  selectable = true,
  allowColumnReorder = true,
  plainColumnHeaders = false,
  selectAllScope = 'all',
  pagination = true,
  paginationMode = 'client',
  currentPage,
  totalItems,
  itemsPerPage = 20,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
  onRowPress,
  loading = false,
  loadingMode = 'refresh',
  smoothLoading = true,
}: {
  rows: LeadsTableRow[];
  columns: LeadsColumnDef[];
  selectedKeys: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onFetchViewKeys?: () => Promise<string[]>;
  onMoveColumnLeft: (columnId: string) => void;
  onMoveColumnRight: (columnId: string) => void;
  selectable?: boolean;
  allowColumnReorder?: boolean;
  plainColumnHeaders?: boolean;
  selectAllScope?: 'page' | 'all';
  pagination?: boolean;
  paginationMode?: 'client' | 'server';
  currentPage?: number;
  totalItems?: number;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
  onRowPress?: (row: LeadsTableRow) => void;
  loading?: boolean;
  loadingMode?: 'initial' | 'refresh';
  smoothLoading?: boolean;
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const showRefreshSkeleton = useSmoothLoading(loading && loadingMode === 'refresh' && rows.length === 0);
  const isInitialEmptyLoad = loading && loadingMode === 'initial' && rows.length === 0;
  const isRefreshEmptyLoad = loading && loadingMode === 'refresh' && rows.length === 0;
  const shouldShowSkeleton =
    isInitialEmptyLoad || (isRefreshEmptyLoad && (!smoothLoading || showRefreshSkeleton));
  const selectionActive = selectable && selectedKeys.size > 0;
  const visibleColumns = columns.filter((column) => column.visible);
  const effectivePage = Math.max(1, currentPage ?? 1);
  const isServerPagination =
    pagination &&
    paginationMode === 'server' &&
    typeof totalItems === 'number' &&
    Number.isFinite(totalItems) &&
    onPageChange != null;
  const totalPages = isServerPagination ? Math.max(1, Math.ceil(totalItems / itemsPerPage)) : 1;
  const rangeStart =
    isServerPagination && totalItems > 0 ? (effectivePage - 1) * itemsPerPage + 1 : 0;
  const rangeEnd =
    isServerPagination && totalItems > 0
      ? Math.min(totalItems, rangeStart + Math.max(rows.length - 1, 0))
      : 0;

  const tableColumns = useMemo(
    () =>
      buildLeadsTableColumns({
        columns: visibleColumns,
        rows,
        onMoveLeft: onMoveColumnLeft,
        onMoveRight: onMoveColumnRight,
        allowColumnReorder,
        plainColumnHeaders,
      }),
    [allowColumnReorder, plainColumnHeaders, visibleColumns, rows, onMoveColumnLeft, onMoveColumnRight],
  );

  const skeletonProps = {
    isMobile,
    tableColumns,
    selectable,
    selectedKeys,
    onSelectionChange,
    selectAllScope,
    pagination,
    paginationMode,
    currentPage,
    totalItems,
    itemsPerPage,
    onPageChange,
    sortColumn,
    sortDirection,
    onSortChange,
  };

  if (shouldShowSkeleton) {
    return <WorkbenchTableSkeleton {...skeletonProps} />;
  }

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        title="No rows match this list"
        description="Try adjusting filters or adding different columns."
      />
    );
  }

  if (isMobile) {
    return (
      <View className="gap-4">
        {rows.map((row) => (
          <Pressable key={row.globalLeadId} onPress={() => onRowPress?.(row)}>
            <Card variant="card">
              <Text className="text-white font-instrument-semibold text-base" numberOfLines={1}>
                {String(row.cells[visibleColumns[0]?.id ?? ''] ?? row.globalLeadId)}
              </Text>
              {visibleColumns.slice(1, 5).map((column) => (
                <View key={column.id} className="gap-1 mt-2">
                  <Text className="text-gray-500 font-instrument text-xs uppercase">{column.label}</Text>
                  <Text className="text-white font-instrument text-sm" numberOfLines={2}>
                    {String(row.cells[column.id] ?? '—')}
                  </Text>
                </View>
              ))}
            </Card>
          </Pressable>
        ))}

        {isServerPagination && totalItems > 0 && totalPages > 1 ? (
          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-[#2A2A2A] bg-[#181818] px-4 py-3">
            <Text className="flex-1 text-sm text-gray-400 font-instrument">
              {`Showing ${rangeStart}-${rangeEnd} of ${totalItems}`}
            </Text>
            <View className="flex-row gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={effectivePage <= 1}
                onPress={() => onPageChange(Math.max(1, effectivePage - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={effectivePage >= totalPages}
                onPress={() => onPageChange(Math.min(totalPages, effectivePage + 1))}
              >
                Next
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <DataTable
      items={rows}
      getItemKey={(row) => row.globalLeadId}
      columns={tableColumns}
      selectable={selectable}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      onFetchViewKeys={onFetchViewKeys}
      selectAllScope={selectAllScope}
      pagination={pagination}
      paginationMode={paginationMode}
      currentPage={currentPage}
      totalItems={totalItems}
      itemsPerPage={itemsPerPage}
      onPageChange={onPageChange}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      onRowPress={selectionActive ? undefined : onRowPress}
      widthMode="content-aware"
      loading={loading && loadingMode === 'refresh'}
      smoothLoading={smoothLoading}
    />
  );
}
