import { useState, useMemo, useEffect, ReactNode } from 'react';
import { ActivityIndicator, View, Text, Pressable, ScrollView } from 'react-native';
import { ChevronUpIcon, ChevronDownIcon } from 'react-native-heroicons/outline';
import { Checkbox } from '@/components/ui/Checkbox';
import { Skeleton, useSmoothLoading, type UseSmoothLoadingOptions } from '@/components/ui/feedback';
import { Tooltip } from '@/components/ui/Tooltip';

/** Extra padding on the left of the first column and right of the last column so content isn't flush to the table edges. */
const OUTER_EDGE_PADDING_X = 24;

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  sortable?: boolean;
  sortValue?: (item: T) => string | number;
  render: (item: T) => ReactNode;
  /** When set, show a filled/empty bar in the header and a tooltip on hover with counts and percentages. */
  headerStats?: { filled: number; empty: number };
  /** When set with headerStats, use this fixed width for the bar (ensures consistent bar width and avoids overflow). */
  headerStatsBarWidth?: number;
}

interface DataTableProps<T> {
  items: T[];
  columns: TableColumn<T>[];
  itemsPerPage?: number;
  loading?: boolean;
  emptyMessage?: string;
  onRowPress?: (item: T) => void;
  getItemKey: (item: T) => string;
  /** When true, show checkbox column and allow row selection. Requires selectedKeys and onSelectionChange. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  /** When false, show all sorted items and hide pagination UI. Default true. */
  pagination?: boolean;
  /** When provided and there are no items, render this instead of emptyMessage. */
  renderEmpty?: () => ReactNode;
  /** When true, columns share width equally (flex: 1 when no column.flex). When false, columns use only minWidth/content. Default false. */
  equalColumnWidths?: boolean;
  /** When true, header row uses vertically centered single-line cells (no stats bar). Default false. */
  compactHeader?: boolean;
  paginationMode?: 'client' | 'server';
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  sortColumn?: string;
  sortDirection?: SortDirection;
  onSortChange?: (columnKey: string, direction: SortDirection) => void;
  hidePaginationWhenSinglePage?: boolean;
  smoothLoading?: boolean;
  smoothLoadingOptions?: UseSmoothLoadingOptions;
}

type SortDirection = 'asc' | 'desc';

export function DataTable<T>({
  items,
  columns,
  itemsPerPage = 20,
  loading = false,
  emptyMessage = 'No items found',
  onRowPress,
  getItemKey,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  pagination: paginationEnabled = true,
  renderEmpty,
  equalColumnWidths = false,
  compactHeader = false,
  paginationMode = 'client',
  currentPage,
  totalItems,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
  hidePaginationWhenSinglePage = true,
  smoothLoading = false,
  smoothLoadingOptions,
}: DataTableProps<T>) {
  const [internalSortColumn, setInternalSortColumn] = useState<string | null>(null);
  const [tableContainerWidth, setTableContainerWidth] = useState<number>(0);
  const [internalSortDirection, setInternalSortDirection] = useState<SortDirection>('asc');
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const hasFiniteServerTotal = typeof totalItems === 'number' && Number.isFinite(totalItems);
  const isServerPagination = paginationEnabled && paginationMode === 'server' && hasFiniteServerTotal && onPageChange != null;
  const effectiveSortColumn = isServerPagination ? sortColumn ?? null : internalSortColumn;
  const effectiveSortDirection = isServerPagination ? sortDirection ?? 'asc' : internalSortDirection;
  const effectiveCurrentPage = isServerPagination ? Math.max(1, currentPage ?? 1) : internalCurrentPage;

  useEffect(() => {
    setInternalCurrentPage(1);
  }, [itemsPerPage]);

  const sortedItems = useMemo(() => {
    if (isServerPagination || !effectiveSortColumn) return items;

    const column = columns.find((col) => col.key === effectiveSortColumn);
    if (!column || !column.sortable || !column.sortValue) return items;

    const sorted = [...items].sort((a, b) => {
      const aValue = column.sortValue!(a);
      const bValue = column.sortValue!(b);

      if (aValue < bValue) return effectiveSortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return effectiveSortDirection === 'asc' ? 1 : -1;
      // Stable sort: break ties by item key so equal-value rows have deterministic order
      const keyA = getItemKey(a);
      const keyB = getItemKey(b);
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });

    return sorted;
  }, [items, effectiveSortColumn, effectiveSortDirection, columns, getItemKey, isServerPagination]);

  const safeServerTotal = isServerPagination ? Math.max(0, Math.floor(totalItems ?? 0)) : items.length;
  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil((isServerPagination ? safeServerTotal : sortedItems.length) / itemsPerPage))
    : 1;

  const visibleItems = useMemo(() => {
    if (!paginationEnabled) return sortedItems;
    if (isServerPagination) return items;
    const start = (effectiveCurrentPage - 1) * itemsPerPage;
    return sortedItems.slice(start, start + itemsPerPage);
  }, [paginationEnabled, sortedItems, effectiveCurrentPage, itemsPerPage, isServerPagination, items]);

  const totalVisibleItems = isServerPagination ? safeServerTotal : sortedItems.length;
  const rangeStart = totalVisibleItems === 0 ? 0 : (effectiveCurrentPage - 1) * itemsPerPage + 1;
  const rangeEnd =
    totalVisibleItems === 0
      ? 0
      : isServerPagination
        ? Math.min(totalVisibleItems, rangeStart + visibleItems.length - 1)
        : Math.min(totalVisibleItems, effectiveCurrentPage * itemsPerPage);
  const smoothSkeleton = useSmoothLoading(loading && items.length === 0, smoothLoadingOptions);
  const smoothUpdating = useSmoothLoading(loading && items.length > 0, smoothLoadingOptions);
  const showSkeleton = smoothLoading ? smoothSkeleton : loading && items.length === 0;
  const showUpdating = smoothLoading ? smoothUpdating : loading && items.length > 0;

  const changePage = (nextPage: number) => {
    const clampedPage = Math.min(Math.max(1, nextPage), totalPages);
    if (isServerPagination) {
      onPageChange?.(clampedPage);
      return;
    }
    setInternalCurrentPage(clampedPage);
  };

  const allSelected =
    selectable &&
    visibleItems.length > 0 &&
    selectedKeys != null &&
    visibleItems.every((item) => selectedKeys.has(getItemKey(item)));

  const someSelected =
    selectable &&
    selectedKeys != null &&
    visibleItems.some((item) => selectedKeys.has(getItemKey(item))) &&
    !allSelected;

  const toggleSelectAll = () => {
    if (!selectable || !onSelectionChange || selectedKeys == null) return;
    const visibleKeys = new Set(visibleItems.map(getItemKey));
    if (allSelected) {
      const next = new Set(selectedKeys);
      visibleKeys.forEach((k) => next.delete(k));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedKeys);
      visibleKeys.forEach((k) => next.add(k));
      onSelectionChange(next);
    }
  };

  const getColumnFlex = (column: TableColumn<T>) =>
    column.flex !== undefined ? column.flex : equalColumnWidths ? 1 : 0;

  const minOfColumnMinWidths = useMemo(() => {
    const widths = columns.map((c) => c.minWidth).filter((w): w is number => w != null);
    return widths.length > 0 ? Math.min(...widths) : undefined;
  }, [columns]);

  const toggleRow = (key: string) => {
    if (!selectable || !onSelectionChange || selectedKeys == null) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  const handleSort = (columnKey: string) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column || !column.sortable) return;
    if (isServerPagination && !onSortChange) return;

    const nextDirection: SortDirection =
      effectiveSortColumn === columnKey && effectiveSortDirection === 'asc' ? 'desc' : 'asc';

    if (isServerPagination) {
      onSortChange?.(columnKey, nextDirection);
      changePage(1);
    } else {
      setInternalSortColumn(columnKey);
      setInternalSortDirection(nextDirection);
      setInternalCurrentPage(1);
    }
  };

  const SortButton = ({ columnKey, label }: { columnKey: string; label: ReactNode }) => {
    const column = columns.find((col) => col.key === columnKey);
    if (!column || !column.sortable) {
      if (typeof label === 'string' || typeof label === 'number') {
        return (
          <Text className="text-gray-400 font-instrument-semibold text-xs uppercase" style={{ textAlign: 'left' }}>
            {label}
          </Text>
        );
      }
      return <View className="self-start">{label}</View>;
    }

    const isActive = effectiveSortColumn === columnKey;
    return (
      <Pressable
        onPress={() => handleSort(columnKey)}
        className="flex-row items-center gap-1 pl-0 pr-3 py-2 active:opacity-70 max-w-full"
      >
        {typeof label === 'string' || typeof label === 'number' ? (
          <Text
            className={`text-xs font-instrument-semibold ${
              isActive ? 'text-white' : 'text-gray-400'
            }`}
            style={{ textAlign: 'left' }}
          >
            {label}
          </Text>
        ) : (
          <View className="flex-1 min-w-0 flex-row items-center">{label}</View>
        )}
        {isActive && (
          <>
            {effectiveSortDirection === 'asc' ? (
              <ChevronUpIcon size={14} color="#fff" />
            ) : (
              <ChevronDownIcon size={14} color="#fff" />
            )}
          </>
        )}
      </Pressable>
    );
  };

  const HeaderCellWithStats = ({ column, index, isFirst, isLast, minOfColumnMinWidths: minMinW }: {
    column: TableColumn<T>;
    index: number;
    isFirst: boolean;
    isLast: boolean;
    minOfColumnMinWidths?: number;
  }) => {
    const minOfColumnMinWidths = minMinW;
    const cellFlex = getColumnFlex(column);
    const stats = column.headerStats;
    const total = stats ? stats.filled + stats.empty : 0;
    const filledPct = total > 0 ? Math.round((stats!.filled / total) * 100) : 0;
    const emptyPct = total > 0 ? 100 - filledPct : 0;

    const cellPaddingH = 24;
    const fullBarWidth =
      minOfColumnMinWidths != null
        ? Math.max(0, minOfColumnMinWidths - cellPaddingH)
        : column.minWidth != null
          ? Math.max(0, column.minWidth - cellPaddingH)
          : undefined;
    const barWidth =
      column.headerStatsBarWidth ??
      (fullBarWidth != null ? Math.floor(fullBarWidth / 2) : undefined);
    const bar = stats && total > 0 && (
      <View
        style={{
          width: barWidth,
          marginRight: 8,
          flexDirection: 'row',
          height: 4,
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: '#2A2A2A',
        }}
      >
        <View style={{ flex: stats.filled, backgroundColor: '#22c55e' }} />
        <View style={{ flex: stats.empty, backgroundColor: '#ef4444' }} />
      </View>
    );

    const tooltipContent =
      stats && total > 0 ? (
        <>
          <Text className="text-white font-instrument text-xs">
            {stats.filled} filled ({filledPct}%)
          </Text>
          <Text className="text-gray-400 font-instrument text-xs mt-0.5">
            {stats.empty} empty ({emptyPct}%)
          </Text>
        </>
      ) : null;

    const labelContent =
      stats && total > 0 && tooltipContent ? (
        <Tooltip content={tooltipContent} placement="top">
          <View style={{ flex: 1, minWidth: 0 }}>
            <SortButton columnKey={column.key} label={column.label} />
          </View>
        </Tooltip>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <SortButton columnKey={column.key} label={column.label} />
        </View>
      );

    return (
      <View
        className="px-2 py-2"
        style={{
          minWidth: column.minWidth,
          maxWidth: column.maxWidth,
          flex: cellFlex,
          paddingLeft: !selectable && isFirst ? OUTER_EDGE_PADDING_X : undefined,
          paddingRight: isLast ? OUTER_EDGE_PADDING_X : 16,
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          minHeight: 44,
        }}
      >
        {labelContent}
        {bar ?? <View style={{ height: 4 }} />}
      </View>
    );
  };

  if (showSkeleton) {
    const skeletonColumnCount = columns.length + (selectable ? 1 : 0);
    const skeletonRowCount = 6;
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
        <View className="flex-row border-b border-[#2A2A2A] bg-[#1F1F1F]">
          {Array.from({ length: skeletonColumnCount }).map((_, i) => (
            <View
              key={i}
              className="px-2 py-2 justify-center"
              style={{
                width: i === 0 && selectable ? 56 : undefined,
                flex: i === 0 && selectable ? 0 : equalColumnWidths ? 1 : 0,
                minWidth: i === 0 && selectable ? undefined : equalColumnWidths ? undefined : 80,
                paddingLeft: i === 0 ? OUTER_EDGE_PADDING_X : undefined,
                paddingRight: i === skeletonColumnCount - 1 ? OUTER_EDGE_PADDING_X : undefined,
              }}
            >
              <Skeleton style={{ height: 14, width: i === 0 && selectable ? 20 : 70, borderRadius: 4 }} />
            </View>
          ))}
        </View>
        {Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
          <View
            key={rowIndex}
            className={`flex-row border-b border-[#2A2A2A] ${rowIndex === skeletonRowCount - 1 ? 'border-b-0' : ''}`}
            style={{ minHeight: 48 }}
          >
            {Array.from({ length: skeletonColumnCount }).map((_, colIndex) => (
              <View
                key={colIndex}
                className="px-2 py-2 justify-center items-center"
                style={{
                  width: colIndex === 0 && selectable ? 56 : undefined,
                  flex: colIndex === 0 && selectable ? 0 : equalColumnWidths ? 1 : 0,
                  minWidth: colIndex === 0 && selectable ? undefined : equalColumnWidths ? undefined : 80,
                  paddingLeft: colIndex === 0 ? OUTER_EDGE_PADDING_X : undefined,
                  paddingRight: colIndex === skeletonColumnCount - 1 ? OUTER_EDGE_PADDING_X : undefined,
                }}
              >
                <Skeleton
                  style={{
                    height: 14,
                    width: colIndex === 0 && selectable ? 20 : 60 + (colIndex % 3) * 20,
                    borderRadius: 4,
                  }}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
      {showUpdating && (
        <View className="absolute right-3 top-3 z-10 flex-row items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#111111]/95 px-2.5 py-1.5">
          <ActivityIndicator size="small" color="#9ca3af" />
          <Text className="text-xs text-gray-400 font-instrument">Updating...</Text>
        </View>
      )}
      <View
        style={{ width: '100%' }}
        onLayout={(e) => setTableContainerWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={tableContainerWidth > 0 ? { minWidth: tableContainerWidth } : undefined}
        >
          <View
            className="overflow-hidden"
            style={tableContainerWidth > 0 ? { minWidth: tableContainerWidth } : undefined}
          >
            {/* Table Header */}
            <View
              className={`flex-row border-b border-[#2A2A2A] bg-[#1F1F1F] ${compactHeader ? 'items-center' : ''}`}
              style={compactHeader ? { minHeight: 48 } : undefined}
            >
          {selectable && (
            <View className="px-2 py-2 justify-center items-center" style={{ width: 56, paddingLeft: OUTER_EDGE_PADDING_X }}>
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onPress={toggleSelectAll}
              />
            </View>
          )}
          {columns.map((column, index) =>
            compactHeader ? (
              <View
                key={column.key}
                className="px-2 py-2 justify-center items-start"
                style={{
                  minWidth: column.minWidth,
                  maxWidth: column.maxWidth,
                  flex: getColumnFlex(column),
                  paddingLeft: !selectable && index === 0 ? OUTER_EDGE_PADDING_X : undefined,
                  paddingRight: index < columns.length - 1 ? 16 : OUTER_EDGE_PADDING_X,
                }}
              >
                <SortButton columnKey={column.key} label={column.label} />
              </View>
            ) : (
              <HeaderCellWithStats
                key={column.key}
                column={column}
                index={index}
                isFirst={index === 0}
                isLast={index === columns.length - 1}
                minOfColumnMinWidths={minOfColumnMinWidths}
              />
            )
          )}
        </View>

        {/* Table Rows */}
        {visibleItems.length === 0 ? (
          <View className="py-12 items-center">
            {renderEmpty ? renderEmpty() : (
              <Text className="text-gray-500 font-instrument text-sm">{emptyMessage}</Text>
            )}
          </View>
        ) : (
          <>
            {visibleItems.map((item, rowIndex) => {
              const key = getItemKey(item);
              // Use rowIndex in key so duplicate item keys don't break React reconciliation (stuck rows)
              const uniqueRowKey = `${key}-${rowIndex}`;
              const isSelected = selectable && selectedKeys != null && selectedKeys.has(key);
              const isLastRow = rowIndex === visibleItems.length - 1;
              const RowContent = (
                <View
                  className={`flex-row items-center border-b border-[#2A2A2A] ${isLastRow ? 'border-b-0' : ''} ${isSelected ? 'bg-[#1F1F1F]' : ''}`}
                  style={{ minHeight: 48 }}
                >
                  {selectable && (
                    <View className="px-2 py-2 justify-center items-center" style={{ width: 56, paddingLeft: OUTER_EDGE_PADDING_X }}>
                      <Checkbox
                        checked={selectedKeys?.has(key) ?? false}
                        onPress={() => toggleRow(key)}
                      />
                    </View>
                  )}
                  {columns.map((column, index) => (
                    <View
                      key={column.key}
                      className="px-2 py-2 justify-start items-start"
                      style={{
                        minWidth: column.minWidth,
                        maxWidth: column.maxWidth,
                        flex: getColumnFlex(column),
                        paddingLeft: !selectable && index === 0 ? OUTER_EDGE_PADDING_X : undefined,
                        paddingRight: index < columns.length - 1 ? 16 : OUTER_EDGE_PADDING_X,
                      }}
                    >
                      {column.render(item)}
                    </View>
                  ))}
                </View>
              );

              if (onRowPress) {
                return (
                  <Pressable
                    key={uniqueRowKey}
                    onPress={() => onRowPress(item)}
                    className="active:opacity-80"
                  >
                    {RowContent}
                  </Pressable>
                );
              }

              return <View key={uniqueRowKey}>{RowContent}</View>;
            })}
          </>
        )}
          </View>
        </ScrollView>
      </View>

      {/* Pagination */}
      {paginationEnabled && (!hidePaginationWhenSinglePage || totalPages > 1) && totalVisibleItems > 0 && (
        <View className="flex-row items-center justify-between mt-4 pt-4 px-6 pb-4 border-t border-[#2A2A2A]">
          <Text className="text-gray-400 font-instrument text-sm">
            Showing {rangeStart}-{rangeEnd} of {totalVisibleItems}
          </Text>

          <Text className="text-gray-400 font-instrument text-sm">
            Page {effectiveCurrentPage} of {totalPages}
          </Text>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => changePage(effectiveCurrentPage - 1)}
              disabled={effectiveCurrentPage === 1}
              className={`px-4 py-2 rounded-lg border ${
                effectiveCurrentPage === 1
                  ? 'border-[#2A2A2A] opacity-50'
                  : 'border-[#3A3A3A] active:opacity-70'
              }`}
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <Text
                className={`text-sm font-instrument-semibold ${
                  effectiveCurrentPage === 1 ? 'text-gray-500' : 'text-white'
                }`}
              >
                Previous
              </Text>
            </Pressable>
            <Pressable
              onPress={() => changePage(effectiveCurrentPage + 1)}
              disabled={effectiveCurrentPage === totalPages}
              className={`px-4 py-2 rounded-lg border ${
                effectiveCurrentPage === totalPages
                  ? 'border-[#2A2A2A] opacity-50'
                  : 'border-[#3A3A3A] active:opacity-70'
              }`}
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <Text
                className={`text-sm font-instrument-semibold ${
                  effectiveCurrentPage === totalPages ? 'text-gray-500' : 'text-white'
                }`}
              >
                Next
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
