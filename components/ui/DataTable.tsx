import { useState, useMemo, useEffect, ReactNode, useCallback, useRef } from 'react';
import { ActivityIndicator, View, Text, Pressable, ScrollView, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import { ChevronUpIcon, ChevronDownIcon } from 'react-native-heroicons/outline';
import { Checkbox } from '@/components/ui/Checkbox';
import { Skeleton, useSmoothLoading, type UseSmoothLoadingOptions } from '@/components/ui/feedback';
import { Tooltip } from '@/components/ui/Tooltip';

/** Extra padding on the left of the first column and right of the last column so content isn't flush to the table edges. */
const OUTER_EDGE_PADDING_X = 24;
const INNER_COLUMN_PADDING_RIGHT = 16;
const SELECT_COLUMN_PADDING_X = 8;
const MEASUREMENT_SAMPLE_SIZE = 12;

export type TableWidthMode = 'content-aware' | 'equal-fill' | 'weighted-fill';
type TableColumnAlignment = 'start' | 'center' | 'end';

export interface TableColumn<T> {
  key: string;
  label: ReactNode;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  align?: TableColumnAlignment;
  sortable?: boolean;
  /** When set, server/controlled sorting uses this identifier instead of the display column key. */
  serverSortKey?: string;
  sortValue?: (item: T) => string | number;
  render: (item: T) => ReactNode;
  /** When set, show a filled/empty bar in the header and a tooltip on hover with counts and percentages. */
  headerStats?: { filled: number; empty: number };
  /** When set with headerStats, use this fixed width for the bar (ensures consistent bar width and avoids overflow). */
  headerStatsBarWidth?: number;
}

interface TableHeaderLabelProps {
  children: ReactNode;
  active?: boolean;
  className?: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

export function TableHeaderLabel({
  children,
  active = false,
  className = '',
  numberOfLines = 1,
  style,
}: TableHeaderLabelProps) {
  const colorClass = active ? 'text-white' : 'text-gray-400';
  const extraClassName = className ? ` ${className}` : '';

  return (
    <Text
      className={`text-xs font-instrument-semibold uppercase ${colorClass}${extraClassName}`}
      numberOfLines={numberOfLines}
      style={style}
    >
      {children}
    </Text>
  );
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
  /** When true, positive column.flex values may expand to fill extra space when the table is not overflowing. Default false. */
  fillAvailableWidth?: boolean;
  /** Explicit width contract. Defaults to `content-aware`, while legacy fill flags still map to fill modes for compatibility. */
  widthMode?: TableWidthMode;
  /** Optional key to intentionally reset or isolate cached widths when the dataset shape changes. */
  widthCacheKey?: string | number;
  /** Shared fallback minimum width for columns that do not provide `minWidth`. */
  defaultColumnMinWidth?: number;
  /** Shared fallback maximum width for content-aware columns that do not provide `maxWidth`. */
  defaultColumnMaxWidth?: number;
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

export type SortDirection = 'asc' | 'desc';

const SELECT_COLUMN_WIDTH = 56;
const DEFAULT_CELL_MIN_WIDTH = 80;
const DEFAULT_CONTENT_AWARE_COLUMN_MAX_WIDTH = 360;
const HEADER_LABEL_CHARACTER_WIDTH = 7;
const HEADER_LABEL_BASE_WIDTH = 44;
const CONTENT_AWARE_COLUMN_BONUS_MAX = 20;
const HEADER_CONTROL_MIN_HEIGHT = 32;
const HEADER_BAR_SPACING = 6;
const contentAwareWidthCache = new Map<string, Record<string, number>>();
const measuredLayoutKeys = new Set<string>();

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
  fillAvailableWidth = false,
  widthMode,
  widthCacheKey,
  defaultColumnMinWidth = DEFAULT_CELL_MIN_WIDTH,
  defaultColumnMaxWidth = DEFAULT_CONTENT_AWARE_COLUMN_MAX_WIDTH,
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
  const measurementItems = useMemo(() => visibleItems.slice(0, MEASUREMENT_SAMPLE_SIZE), [visibleItems]);

  const totalVisibleItems = isServerPagination ? safeServerTotal : sortedItems.length;
  const rangeStart = totalVisibleItems === 0 ? 0 : (effectiveCurrentPage - 1) * itemsPerPage + 1;
  const rangeEnd =
    totalVisibleItems === 0
      ? 0
      : isServerPagination
        ? Math.min(totalVisibleItems, rangeStart + visibleItems.length - 1)
        : Math.min(totalVisibleItems, effectiveCurrentPage * itemsPerPage);
  const isInitialLoading = loading && items.length === 0;
  const hasLoadedItems = items.length > 0;
  const smoothSkeleton = useSmoothLoading(isInitialLoading, smoothLoadingOptions);
  const smoothUpdating = useSmoothLoading(loading && hasLoadedItems, smoothLoadingOptions);
  const shouldShowSkeleton = isInitialLoading && (!smoothLoading || smoothSkeleton);
  const shouldShowUpdatingOverlay = !isInitialLoading && (smoothLoading ? smoothUpdating : loading && hasLoadedItems);
  const resolvedWidthMode: TableWidthMode = widthMode
    ?? (equalColumnWidths ? 'equal-fill' : fillAvailableWidth ? 'weighted-fill' : 'content-aware');
  const isContentAwareWidthMode = resolvedWidthMode === 'content-aware';
  const isEqualFillWidthMode = resolvedWidthMode === 'equal-fill';

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

  const getSortIdentifier = (column: TableColumn<T>) => column.serverSortKey ?? column.key;

  const isPlainTextLabel = (column: TableColumn<T>) =>
    typeof column.label === 'string' || typeof column.label === 'number';

  const getColumnForSortIdentifier = (sortIdentifier: string | null) =>
    sortIdentifier == null
      ? undefined
      : columns.find((column) => column.key === sortIdentifier || column.serverSortKey === sortIdentifier);

  const getEffectiveColumnMinWidth = useCallback(
    (column: TableColumn<T>) =>
      Math.max(
        column.minWidth ?? defaultColumnMinWidth,
        isPlainTextLabel(column)
          ? Math.ceil(String(column.label).length * HEADER_LABEL_CHARACTER_WIDTH) + HEADER_LABEL_BASE_WIDTH
          : 0
      ),
    [defaultColumnMinWidth]
  );
  const getEffectiveColumnMaxWidth = useCallback(
    (column: TableColumn<T>) => {
      const baseMaxWidth = column.maxWidth ?? (isContentAwareWidthMode ? defaultColumnMaxWidth : undefined);
      const requiredHeaderWidth = isPlainTextLabel(column)
        ? Math.ceil(String(column.label).length * HEADER_LABEL_CHARACTER_WIDTH) + HEADER_LABEL_BASE_WIDTH
        : 0;
      return baseMaxWidth != null ? Math.max(baseMaxWidth, requiredHeaderWidth) : undefined;
    },
    [defaultColumnMaxWidth, isContentAwareWidthMode]
  );
  const getEstimatedHeaderWidth = useCallback(
    (column: TableColumn<T>) => {
      if (typeof column.label !== 'string' && typeof column.label !== 'number') return 0;
      return Math.ceil(String(column.label).length * HEADER_LABEL_CHARACTER_WIDTH) + HEADER_LABEL_BASE_WIDTH;
    },
    []
  );
  const getColumnPaddingStyle = (index: number) => ({
    paddingLeft: !selectable && index === 0 ? OUTER_EDGE_PADDING_X : undefined,
    paddingRight: index < columns.length - 1 ? INNER_COLUMN_PADDING_RIGHT : OUTER_EDGE_PADDING_X,
  });
  const getColumnAlignment = (column: TableColumn<T>): TableColumnAlignment => column.align ?? 'start';
  const getAlignItemsForAlignment = (alignment: TableColumnAlignment) => {
    if (alignment === 'end') return 'flex-end' as const;
    if (alignment === 'center') return 'center' as const;
    return 'flex-start' as const;
  };
  const getAlignItemsForColumn = (column: TableColumn<T>) => {
    return getAlignItemsForAlignment(getColumnAlignment(column));
  };
  const getTextAlignForAlignment = (alignment: TableColumnAlignment) => {
    if (alignment === 'end') return 'right' as const;
    if (alignment === 'center') return 'center' as const;
    return 'left' as const;
  };
  const getTextAlignForColumn = (column: TableColumn<T>) => {
    return getTextAlignForAlignment(getColumnAlignment(column));
  };
  const getJustifyContentForAlignment = (alignment: TableColumnAlignment) => {
    if (alignment === 'end') return 'flex-end' as const;
    if (alignment === 'center') return 'center' as const;
    return 'flex-start' as const;
  };
  const getJustifyContentForColumn = (column: TableColumn<T>) => {
    return getJustifyContentForAlignment(getColumnAlignment(column));
  };
  const selectColumnWidth = selectable ? SELECT_COLUMN_WIDTH : 0;
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const layoutSignature = useMemo(
    () =>
      JSON.stringify({
        widthMode: resolvedWidthMode,
        widthCacheKey: widthCacheKey ?? null,
        defaultColumnMinWidth,
        defaultColumnMaxWidth,
        selectable,
        columns: columns.map((column) => ({
          key: column.key,
          minWidth: column.minWidth ?? null,
          maxWidth: column.maxWidth ?? null,
          flex: column.flex ?? null,
          primitiveLabel:
            typeof column.label === 'string' || typeof column.label === 'number'
              ? String(column.label)
              : null,
          hasHeaderStats: column.headerStats != null,
          headerStatsBarWidth: column.headerStatsBarWidth ?? null,
        })),
      }),
    [
      columns,
      defaultColumnMaxWidth,
      defaultColumnMinWidth,
      resolvedWidthMode,
      selectable,
      widthCacheKey,
    ]
  );

  const clampColumnWidth = useCallback((column: TableColumn<T>, width: number) => {
    const minWidth = getEffectiveColumnMinWidth(column);
    const maxWidth = getEffectiveColumnMaxWidth(column);
    return Math.max(minWidth, maxWidth != null ? Math.min(width, maxWidth) : width);
  }, [getEffectiveColumnMaxWidth, getEffectiveColumnMinWidth]);
  const getColumnSeedWidth = useCallback(
    (column: TableColumn<T>) =>
      clampColumnWidth(
        column,
        Math.max(getEffectiveColumnMinWidth(column), getEstimatedHeaderWidth(column))
      ),
    [clampColumnWidth, getEffectiveColumnMinWidth, getEstimatedHeaderWidth]
  );

  const seededColumnWidths = useMemo(
    () =>
      columns.reduce(
        (acc, column) => {
          acc[column.key] = getColumnSeedWidth(column);
          return acc;
        },
        {} as Record<string, number>
      ),
    [columns, getColumnSeedWidth]
  );
  const getCachedMeasuredWidths = useCallback(() => {
    if (!measuredLayoutKeys.has(layoutSignature)) return seededColumnWidths;

    const cachedWidths = contentAwareWidthCache.get(layoutSignature);
    if (!cachedWidths) return seededColumnWidths;

    return columns.reduce(
      (acc, column) => {
        const seededWidth = seededColumnWidths[column.key];
        const cachedWidth = cachedWidths[column.key];
        acc[column.key] =
          cachedWidth != null ? clampColumnWidth(column, Math.max(seededWidth, cachedWidth)) : seededWidth;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [clampColumnWidth, columns, layoutSignature, seededColumnWidths]);
  const [measuredColumnWidths, setMeasuredColumnWidths] = useState<Record<string, number>>(() => getCachedMeasuredWidths());
  const measuredColumnWidthsRef = useRef<Record<string, number>>(getCachedMeasuredWidths());
  const measurementCellKeysRef = useRef<Set<string>>(new Set());
  const debugRunIdRef = useRef(`datatable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const headerLayoutLoggedRef = useRef(false);
  const firstRowLayoutLoggedRef = useRef(false);
  const headerCellLayoutLoggedKeysRef = useRef<Set<string>>(new Set());
  const firstRowCellLayoutLoggedKeysRef = useRef<Set<string>>(new Set());
  const firstInteractiveRowLoggedRef = useRef(false);
  const headerLayoutsRef = useRef<Record<string, { index: number; x: number; width: number; expectedWidth: number }>>({});
  const firstRowLayoutsRef = useRef<Record<string, { index: number; x: number; width: number; expectedWidth: number }>>({});
  const debugLog = useCallback(
    (hypothesisId: string, message: string, data: Record<string, unknown>) => {
      fetch('http://127.0.0.1:7447/ingest/0a9c766e-cfbc-4a65-8b11-aa0dd657a9e5', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': 'a13dbb',
        },
        body: JSON.stringify({
          sessionId: 'a13dbb',
          runId: debugRunIdRef.current,
          hypothesisId,
          location: 'components/ui/DataTable.tsx',
          message,
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    },
    []
  );
  const hasCachedMeasuredWidths = measuredLayoutKeys.has(layoutSignature);
  const requiredMeasurementCellCount = columns.length * (1 + measurementItems.length);
  const [isMeasurementReady, setIsMeasurementReady] = useState(
    () => visibleItems.length === 0 || columns.length === 0 || measuredLayoutKeys.has(layoutSignature)
  );

  useEffect(() => {
    const nextMeasuredWidths = getCachedMeasuredWidths();
    measuredColumnWidthsRef.current = nextMeasuredWidths;
    setMeasuredColumnWidths(nextMeasuredWidths);
  }, [getCachedMeasuredWidths, layoutSignature]);

  useEffect(() => {
    measurementCellKeysRef.current = new Set();
    setIsMeasurementReady(visibleItems.length === 0 || columns.length === 0 || measuredLayoutKeys.has(layoutSignature));
  }, [columns.length, layoutSignature, visibleItems.length]);

  const reportMeasuredWidth = useCallback(
    (columnKey: string, width: number) => {
      if (width <= 0) return;

      const column = columnMap.get(columnKey);
      if (!column) return;

      const nextWidth = clampColumnWidth(column, width);
      const currentWidth = measuredColumnWidthsRef.current[columnKey] ?? getEffectiveColumnMinWidth(column);
      if (nextWidth <= currentWidth) return;

      measuredColumnWidthsRef.current = {
        ...measuredColumnWidthsRef.current,
        [columnKey]: nextWidth,
      };
      contentAwareWidthCache.set(layoutSignature, { ...measuredColumnWidthsRef.current });
      // #region agent log
      debugLog('H2', 'Measured column width increased', {
        columnKey,
        currentWidth,
        nextWidth,
        widthMode: resolvedWidthMode,
      });
      // #endregion
      setMeasuredColumnWidths({ ...measuredColumnWidthsRef.current });
    },
    [clampColumnWidth, columnMap, getEffectiveColumnMinWidth, layoutSignature]
  );

  const reportMeasurementCell = useCallback(
    (measurementKey: string) => {
      if (requiredMeasurementCellCount === 0 || measuredLayoutKeys.has(layoutSignature)) {
        if (!isMeasurementReady) setIsMeasurementReady(true);
        return;
      }

      if (measurementCellKeysRef.current.has(measurementKey)) return;
      measurementCellKeysRef.current.add(measurementKey);

      if (measurementCellKeysRef.current.size < requiredMeasurementCellCount) return;

      measuredLayoutKeys.add(layoutSignature);
      contentAwareWidthCache.set(layoutSignature, { ...measuredColumnWidthsRef.current });
      setIsMeasurementReady(true);
    },
    [isMeasurementReady, layoutSignature, requiredMeasurementCellCount]
  );

  useEffect(() => {
    if (!measuredLayoutKeys.has(layoutSignature)) return;
    contentAwareWidthCache.set(layoutSignature, { ...measuredColumnWidths });
  }, [layoutSignature, measuredColumnWidths]);

  const minOfColumnMinWidths = useMemo(() => {
    const widths = columns.map((column) => getEffectiveColumnMinWidth(column));
    return widths.length > 0 ? Math.min(...widths) : undefined;
  }, [columns, getEffectiveColumnMinWidth]);

  const resolvedColumnWidths = useMemo(
    () =>
      columns.reduce(
        (acc, column) => {
          acc[column.key] = measuredColumnWidths[column.key] ?? getEffectiveColumnMinWidth(column);
          return acc;
        },
        {} as Record<string, number>
      ),
    [columns, getEffectiveColumnMinWidth, measuredColumnWidths]
  );

  const intrinsicTableWidth = useMemo(
    () => columns.reduce((total, column) => total + resolvedColumnWidths[column.key], selectColumnWidth),
    [columns, resolvedColumnWidths, selectColumnWidth]
  );

  const hasMeasuredContainerWidth = tableContainerWidth > 0;
  const isOverflowing = hasMeasuredContainerWidth && intrinsicTableWidth > tableContainerWidth;
  const shouldFillColumns = hasMeasuredContainerWidth && !isOverflowing;
  const shouldHideTableUntilReady = visibleItems.length > 0 && (!hasMeasuredContainerWidth || !isMeasurementReady);
  const shouldShowEmptyState = visibleItems.length === 0 && !loading;
  const tableSurfaceWidth = hasMeasuredContainerWidth
    ? isOverflowing
      ? intrinsicTableWidth
      : tableContainerWidth
    : intrinsicTableWidth;

  const contentAwareColumnBonus = useMemo(() => {
    if (
      !isContentAwareWidthMode
      || !hasMeasuredContainerWidth
      || isOverflowing
      || columns.length < 2
      || tableContainerWidth <= intrinsicTableWidth
    ) {
      return 0;
    }

    const availableWidth = tableContainerWidth - intrinsicTableWidth;
    const gapCount = columns.length - 1;
    return Math.min(CONTENT_AWARE_COLUMN_BONUS_MAX, Math.floor(availableWidth / gapCount));
  }, [columns.length, hasMeasuredContainerWidth, intrinsicTableWidth, isContentAwareWidthMode, isOverflowing, tableContainerWidth]);

  const getColumnGrow = (column: TableColumn<T>) => {
    if (resolvedWidthMode === 'weighted-fill') {
      return column.flex ?? 0;
    }

    if (isEqualFillWidthMode) {
      return column.flex !== undefined ? column.flex : 1;
    }

    return 0;
  };

  const getColumnLayoutStyle = (column: TableColumn<T>, index: number) => {
    const columnBaseWidth = resolvedColumnWidths[column.key] ?? getEffectiveColumnMinWidth(column);
    const columnMaxWidth = getEffectiveColumnMaxWidth(column);
    const displayWidth =
      isContentAwareWidthMode && index < columns.length - 1
        ? columnBaseWidth + contentAwareColumnBonus
        : columnBaseWidth;

    if (isContentAwareWidthMode) {
      return {
        width: displayWidth,
        minWidth: displayWidth,
        maxWidth: displayWidth,
        flexBasis: displayWidth,
        flexGrow: 0,
        flexShrink: 0,
      } as const;
    }

    if (!hasMeasuredContainerWidth) {
      return {
        width: displayWidth,
        minWidth: displayWidth,
        maxWidth: displayWidth,
        flexBasis: displayWidth,
        flexGrow: 0,
        flexShrink: 0,
      } as const;
    }

    const flexGrow = shouldFillColumns ? getColumnGrow(column) : 0;
    return {
      minWidth: displayWidth,
      maxWidth: columnMaxWidth,
      flexBasis: displayWidth,
      flexGrow,
      flexShrink: shouldFillColumns && flexGrow > 0 ? 1 : 0,
    } as const;
  };

  const getExpectedDisplayWidth = useCallback(
    (column: TableColumn<T>, index: number) => {
      const columnBaseWidth = resolvedColumnWidths[column.key] ?? getEffectiveColumnMinWidth(column);
      return isContentAwareWidthMode && index < columns.length - 1
        ? columnBaseWidth + contentAwareColumnBonus
        : columnBaseWidth;
    },
    [columns.length, contentAwareColumnBonus, getEffectiveColumnMinWidth, isContentAwareWidthMode, resolvedColumnWidths]
  );

  const intrinsicContentLoggedKeysRef = useRef<Set<string>>(new Set());

  const reportVisibleLayout = useCallback(
    (
      hypothesisId: string,
      message: string,
      targetRef: React.MutableRefObject<Record<string, { index: number; x: number; width: number; expectedWidth: number }>>,
      loggedRef: React.MutableRefObject<boolean>,
      column: TableColumn<T>,
      index: number,
      x: number,
      width: number
    ) => {
      if (loggedRef.current) return;
      targetRef.current[column.key] = {
        index,
        x,
        width,
        expectedWidth: getExpectedDisplayWidth(column, index),
      };
      if (Object.keys(targetRef.current).length !== columns.length) return;
      loggedRef.current = true;
      // #region agent log
      debugLog(hypothesisId, message, {
        widthMode: resolvedWidthMode,
        tableContainerWidth,
        intrinsicTableWidth,
        tableSurfaceWidth,
        layouts: Object.values(targetRef.current).sort((a, b) => a.index - b.index),
      });
      // #endregion
    },
    [columns.length, debugLog, getExpectedDisplayWidth, intrinsicTableWidth, resolvedWidthMode, tableContainerWidth, tableSurfaceWidth]
  );

  const reportVisibleCellLayout = useCallback(
    (
      hypothesisId: string,
      message: string,
      loggedKeysRef: React.MutableRefObject<Set<string>>,
      column: TableColumn<T>,
      index: number,
      x: number,
      width: number
    ) => {
      if (index > 4 || loggedKeysRef.current.has(column.key)) return;
      loggedKeysRef.current.add(column.key);
      // #region agent log
      debugLog(hypothesisId, message, {
        widthMode: resolvedWidthMode,
        columnKey: column.key,
        index,
        x,
        width,
        expectedWidth: getExpectedDisplayWidth(column, index),
        tableContainerWidth,
        intrinsicTableWidth,
        tableSurfaceWidth,
      });
      // #endregion
    },
    [debugLog, getExpectedDisplayWidth, intrinsicTableWidth, resolvedWidthMode, tableContainerWidth, tableSurfaceWidth]
  );

  useEffect(() => {
    // #region agent log
    debugLog('H1', 'Table width metrics snapshot', {
      widthMode: resolvedWidthMode,
      tableContainerWidth,
      intrinsicTableWidth,
      tableSurfaceWidth,
      isOverflowing,
      contentAwareColumnBonus,
      hasCachedMeasuredWidths,
      shouldHideTableUntilReady,
      firstColumns: columns.slice(0, 5).map((column) => ({
        key: column.key,
        resolvedWidth: resolvedColumnWidths[column.key],
        minWidth: getEffectiveColumnMinWidth(column),
        maxWidth: getEffectiveColumnMaxWidth(column) ?? null,
      })),
    });
    // #endregion
  }, [
    columns,
    contentAwareColumnBonus,
    debugLog,
    getEffectiveColumnMaxWidth,
    getEffectiveColumnMinWidth,
    hasCachedMeasuredWidths,
    intrinsicTableWidth,
    isOverflowing,
    resolvedColumnWidths,
    resolvedWidthMode,
    shouldHideTableUntilReady,
    tableContainerWidth,
    tableSurfaceWidth,
  ]);

  useEffect(() => {
    // #region agent log
    debugLog('H3', 'Visible row key snapshot', {
      widthMode: resolvedWidthMode,
      visibleCount: visibleItems.length,
      firstRowKeys: visibleItems.slice(0, 5).map((item, rowIndex) => ({
        baseKey: getItemKey(item),
        uniqueRowKey: `${getItemKey(item)}-${rowIndex}`,
      })),
    });
    // #endregion
  }, [debugLog, getItemKey, resolvedWidthMode, visibleItems]);

  useEffect(() => {
    headerLayoutLoggedRef.current = false;
    firstRowLayoutLoggedRef.current = false;
    headerCellLayoutLoggedKeysRef.current = new Set();
    firstRowCellLayoutLoggedKeysRef.current = new Set();
    intrinsicContentLoggedKeysRef.current = new Set();
    firstInteractiveRowLoggedRef.current = false;
    headerLayoutsRef.current = {};
    firstRowLayoutsRef.current = {};
  }, [layoutSignature, visibleItems, tableContainerWidth]);

  const reportIntrinsicContentWidth = useCallback(
    (column: TableColumn<T>, index: number, width: number) => {
      if (intrinsicContentLoggedKeysRef.current.has(column.key) || index > 4) return;
      intrinsicContentLoggedKeysRef.current.add(column.key);
      // #region agent log
      debugLog('H12', 'Intrinsic content width probe', {
        widthMode: resolvedWidthMode,
        columnKey: column.key,
        index,
        intrinsicContentWidth: width,
        expectedWidth: getExpectedDisplayWidth(column, index),
        tableContainerWidth,
        intrinsicTableWidth,
        tableSurfaceWidth,
      });
      // #endregion
    },
    [debugLog, getExpectedDisplayWidth, intrinsicTableWidth, resolvedWidthMode, tableContainerWidth, tableSurfaceWidth]
  );

  const getMeasurementColumnLayoutStyle = (column: TableColumn<T>) => ({
    minWidth: getEffectiveColumnMinWidth(column),
    maxWidth: getEffectiveColumnMaxWidth(column),
    flexShrink: 0,
    alignSelf: 'flex-start' as const,
  });

  const hasAnyHeaderStats = columns.some((column) => column.headerStats != null);

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

    const activeColumn = getColumnForSortIdentifier(effectiveSortColumn);
    const activeColumnKey = activeColumn?.key ?? effectiveSortColumn;
    const nextDirection: SortDirection =
      activeColumnKey === columnKey && effectiveSortDirection === 'asc' ? 'desc' : 'asc';

    if (isServerPagination) {
      onSortChange?.(getSortIdentifier(column), nextDirection);
      changePage(1);
    } else {
      setInternalSortColumn(columnKey);
      setInternalSortDirection(nextDirection);
      setInternalCurrentPage(1);
    }
  };

  const SortButton = ({ columnKey, label }: { columnKey: string; label: ReactNode }) => {
    const column = columns.find((col) => col.key === columnKey);
    const fallbackAlignment: TableColumnAlignment = 'start';
    const alignment = column ? getColumnAlignment(column) : fallbackAlignment;
    const controlStyle = {
      alignSelf: getAlignItemsForAlignment(alignment),
      justifyContent: column ? getJustifyContentForColumn(column) : getJustifyContentForAlignment(fallbackAlignment),
      minHeight: HEADER_CONTROL_MIN_HEIGHT,
    };
    if (!column || !column.sortable) {
      if (typeof label === 'string' || typeof label === 'number') {
        return (
          <View className="flex-row items-center gap-1 pl-0 pr-3 py-2 max-w-full" style={controlStyle}>
            <TableHeaderLabel style={{ textAlign: getTextAlignForAlignment(alignment) }}>
              {label}
            </TableHeaderLabel>
          </View>
        );
      }
      return (
        <View className="flex-row items-center gap-1 pl-0 pr-3 py-2 max-w-full" style={controlStyle}>
          <View className="min-w-0 flex-row items-center" style={{ justifyContent: getJustifyContentForAlignment(alignment) }}>
            {label}
          </View>
        </View>
      );
    }

    const isActive = getColumnForSortIdentifier(effectiveSortColumn)?.key === columnKey;
    return (
      <Pressable
        onPress={() => handleSort(columnKey)}
        className="flex-row items-center gap-1 pl-0 pr-3 py-2 active:opacity-70 max-w-full"
        style={controlStyle}
      >
        {typeof label === 'string' || typeof label === 'number' ? (
          <TableHeaderLabel
            active={isActive}
            style={{ textAlign: getTextAlignForColumn(column) }}
          >
            {label}
          </TableHeaderLabel>
        ) : (
          <View className="min-w-0 flex-row items-center" style={{ justifyContent: getJustifyContentForColumn(column) }}>
            {label}
          </View>
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

  const HeaderCellWithStats = ({
    column,
    index,
    layoutStyle,
    onLayout,
  }: {
    column: TableColumn<T>;
    index: number;
    layoutStyle: ReturnType<typeof getColumnLayoutStyle> | ReturnType<typeof getMeasurementColumnLayoutStyle>;
    onLayout?: (e: LayoutChangeEvent) => void;
  }) => {
    const stats = column.headerStats;
    const total = stats ? stats.filled + stats.empty : 0;
    const filledPct = total > 0 ? Math.round((stats!.filled / total) * 100) : 0;
    const emptyPct = total > 0 ? 100 - filledPct : 0;

    const cellPaddingH = 24;
    const fullBarWidth =
      minOfColumnMinWidths != null
        ? Math.max(0, minOfColumnMinWidths - cellPaddingH)
        : getEffectiveColumnMinWidth(column) != null
          ? Math.max(0, getEffectiveColumnMinWidth(column) - cellPaddingH)
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
        collapsable={onLayout ? false : undefined}
        onLayout={onLayout}
        className="px-2 py-2 min-w-0"
        style={{
          ...layoutStyle,
          ...getColumnPaddingStyle(index),
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          minHeight: 44,
        }}
      >
        <View style={{ minHeight: HEADER_CONTROL_MIN_HEIGHT, justifyContent: 'center' }}>
          {labelContent}
        </View>
        {hasAnyHeaderStats ? (
          <View style={{ height: 4, marginTop: HEADER_BAR_SPACING }}>
            {bar}
          </View>
        ) : null}
      </View>
    );
  };

  if (shouldShowSkeleton) {
    const skeletonColumnCount = columns.length + (selectable ? 1 : 0);
    const skeletonRowCount = 6;
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
        <View style={{ width: '100%' }} onLayout={(e) => setTableContainerWidth(e.nativeEvent.layout.width)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            style={{ width: '100%' }}
            contentContainerStyle={tableSurfaceWidth > 0 ? { minWidth: tableSurfaceWidth } : undefined}
          >
            <View
              style={
                tableSurfaceWidth > 0
                  ? {
                      width: tableSurfaceWidth,
                      minWidth: tableSurfaceWidth,
                      alignSelf: 'flex-start',
                    }
                  : undefined
              }
            >
              <View
                className="flex-row border-b border-[#2A2A2A] bg-[#1F1F1F]"
              >
                {Array.from({ length: skeletonColumnCount }).map((_, i) => (
                  <View
                    key={i}
                    className="py-2 justify-center"
                    style={{
                      width: i === 0 && selectable ? SELECT_COLUMN_WIDTH : undefined,
                      ...(i === 0 && selectable
                        ? {}
                        : getColumnLayoutStyle(columns[selectable ? i - 1 : i], selectable ? i - 1 : i)),
                      paddingHorizontal: i === 0 && selectable ? SELECT_COLUMN_PADDING_X : undefined,
                      paddingLeft: i === 0 && !selectable ? OUTER_EDGE_PADDING_X : undefined,
                      paddingRight: i === skeletonColumnCount - 1 && !selectable ? OUTER_EDGE_PADDING_X : undefined,
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
                      className="py-2 justify-center items-center"
                      style={{
                        width: colIndex === 0 && selectable ? SELECT_COLUMN_WIDTH : undefined,
                        ...(colIndex === 0 && selectable
                          ? {}
                          : getColumnLayoutStyle(columns[selectable ? colIndex - 1 : colIndex], selectable ? colIndex - 1 : colIndex)),
                        paddingHorizontal: colIndex === 0 && selectable ? SELECT_COLUMN_PADDING_X : undefined,
                        paddingLeft: colIndex === 0 && !selectable ? OUTER_EDGE_PADDING_X : undefined,
                        paddingRight: colIndex === skeletonColumnCount - 1 && !selectable ? OUTER_EDGE_PADDING_X : undefined,
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
          </ScrollView>
        </View>
      </View>
    );
  }

  const renderHeaderCell = (
    column: TableColumn<T>,
    index: number,
    options?: { measure?: boolean }
  ) => {
    const measure = options?.measure ?? false;
    const layoutStyle = measure ? getMeasurementColumnLayoutStyle(column) : getColumnLayoutStyle(column, index);
    const onLayout = (e: LayoutChangeEvent) => {
      if (measure) {
        reportMeasuredWidth(column.key, e.nativeEvent.layout.width);
        reportMeasurementCell(`header:${column.key}`);
        return;
      }
      reportVisibleCellLayout(
        'H8',
        'Header cell layout event',
        headerCellLayoutLoggedKeysRef,
        column,
        index,
        e.nativeEvent.layout.x,
        e.nativeEvent.layout.width
      );
      reportVisibleLayout(
        'H6',
        'Header cell layout summary',
        headerLayoutsRef,
        headerLayoutLoggedRef,
        column,
        index,
        e.nativeEvent.layout.x,
        e.nativeEvent.layout.width
      );
    };

    if (compactHeader) {
      return (
        <View
          key={column.key}
          collapsable={measure ? false : undefined}
          onLayout={onLayout}
          className="px-2 py-2 justify-center items-start min-w-0"
          style={{
            ...layoutStyle,
            ...getColumnPaddingStyle(index),
            alignItems: 'stretch',
          }}
        >
          <SortButton columnKey={column.key} label={column.label} />
        </View>
      );
    }

    return (
      <HeaderCellWithStats
        key={column.key}
        column={column}
        index={index}
        layoutStyle={layoutStyle}
        onLayout={onLayout}
      />
    );
  };

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl overflow-hidden">
      {shouldShowUpdatingOverlay && (
        <View className="absolute right-3 top-3 z-10 flex-row items-center gap-2 rounded-full border border-[#2A2A2A] bg-[#111111]/95 px-2.5 py-1.5">
          <ActivityIndicator size="small" color="#9ca3af" />
          <Text className="text-xs text-gray-400 font-instrument">Updating...</Text>
        </View>
      )}
      <View
        style={{ width: '100%' }}
        onLayout={(e) => {
          const nextWidth = e.nativeEvent.layout.width;
          setTableContainerWidth(nextWidth);
          // #region agent log
          debugLog('H4', 'Container onLayout fired', {
            nextWidth,
            widthMode: resolvedWidthMode,
            currentIntrinsicTableWidth: intrinsicTableWidth,
            currentSurfaceWidth: tableSurfaceWidth,
          });
          // #endregion
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          style={{ width: '100%' }}
          contentContainerStyle={tableSurfaceWidth > 0 ? { minWidth: tableSurfaceWidth } : undefined}
        >
          <View
            style={{
              ...(tableSurfaceWidth > 0
                ? {
                    width: tableSurfaceWidth,
                    minWidth: tableSurfaceWidth,
                  }
                : {}),
              alignSelf: 'flex-start',
              opacity: shouldHideTableUntilReady ? 0 : 1,
            }}
          >
            {/* Table Header */}
            <View
              className={`flex-row border-b border-[#2A2A2A] bg-[#1F1F1F] ${compactHeader ? 'items-center' : ''}`}
              style={compactHeader ? { minHeight: 48 } : undefined}
            >
              {selectable && (
                <View
                  className="py-2 justify-center items-center"
                  style={{ width: SELECT_COLUMN_WIDTH, paddingHorizontal: SELECT_COLUMN_PADDING_X }}
                >
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onPress={toggleSelectAll}
                  />
                </View>
              )}
              {columns.map((column, index) => renderHeaderCell(column, index))}
            </View>

            {/* Table Rows */}
            {shouldShowEmptyState ? (
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
                        <View
                          className="py-2 justify-center items-center"
                          style={{ width: SELECT_COLUMN_WIDTH, paddingHorizontal: SELECT_COLUMN_PADDING_X }}
                        >
                          <Checkbox
                            checked={selectedKeys?.has(key) ?? false}
                            onPress={() => toggleRow(key)}
                          />
                        </View>
                      )}
                      {columns.map((column, index) => (
                        <View
                          key={column.key}
                          className="px-2 py-2 min-w-0"
                          onLayout={
                            rowIndex === 0
                              ? (e) => {
                                  reportVisibleLayout(
                                    'H7',
                                    'First row cell layout summary',
                                    firstRowLayoutsRef,
                                    firstRowLayoutLoggedRef,
                                    column,
                                    index,
                                    e.nativeEvent.layout.x,
                                    e.nativeEvent.layout.width
                                  );
                                  reportVisibleCellLayout(
                                    'H9',
                                    'First row cell layout event',
                                    firstRowCellLayoutLoggedKeysRef,
                                    column,
                                    index,
                                    e.nativeEvent.layout.x,
                                    e.nativeEvent.layout.width
                                  );
                                }
                              : undefined
                          }
                          style={{
                            ...getColumnLayoutStyle(column, index),
                            ...getColumnPaddingStyle(index),
                            alignItems: 'stretch',
                          }}
                        >
                          <View
                            style={{
                              width: '100%',
                              minWidth: 0,
                              alignItems: getAlignItemsForColumn(column),
                            }}
                          >
                            {column.render(item)}
                          </View>
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
                        onLayout={
                          rowIndex === 0
                            ? (e) => {
                                if (firstInteractiveRowLoggedRef.current) return;
                                firstInteractiveRowLoggedRef.current = true;
                                // #region agent log
                                debugLog('H10', 'Interactive row wrapper layout', {
                                  widthMode: resolvedWidthMode,
                                  width: e.nativeEvent.layout.width,
                                  x: e.nativeEvent.layout.x,
                                  tableSurfaceWidth,
                                  intrinsicTableWidth,
                                  tableContainerWidth,
                                });
                                // #endregion
                              }
                            : undefined
                        }
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

      {columns.length > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: 0 }}>
          <View
            className={`flex-row ${compactHeader ? 'items-center' : ''}`}
            style={compactHeader ? { minHeight: 48 } : undefined}
          >
            {selectable && <View style={{ width: SELECT_COLUMN_WIDTH }} />}
            {columns.map((column, index) => renderHeaderCell(column, index, { measure: true }))}
          </View>
          {measurementItems.map((item, rowIndex) => (
            <View
              key={`measurement-${getItemKey(item)}-${rowIndex}`}
              className="flex-row items-center"
              style={{ minHeight: 48 }}
            >
              {selectable && <View style={{ width: SELECT_COLUMN_WIDTH }} />}
              {columns.map((column, index) => (
                <View
                  key={`${column.key}-${rowIndex}`}
                  collapsable={false}
                  onLayout={(e) => {
                    reportMeasuredWidth(column.key, e.nativeEvent.layout.width);
                    reportMeasurementCell(`cell:${rowIndex}:${column.key}`);
                  }}
                  className="px-2 py-2 justify-start items-start min-w-0"
                  style={{
                    ...getMeasurementColumnLayoutStyle(column),
                    ...getColumnPaddingStyle(index),
                    alignItems: 'stretch',
                  }}
                >
                  <View style={{ minWidth: 0 }}>
                    {column.render(item)}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {visibleItems.length > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: 0 }}>
          <View className="flex-row items-start">
            {selectable && <View style={{ width: SELECT_COLUMN_WIDTH }} />}
            {columns.map((column, index) => (
              <View
                key={`intrinsic-${column.key}`}
                collapsable={false}
                onLayout={(e) => reportIntrinsicContentWidth(column, index, e.nativeEvent.layout.width)}
                style={{ alignSelf: 'flex-start' }}
              >
                {column.render(visibleItems[0])}
              </View>
            ))}
          </View>
        </View>
      )}

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
