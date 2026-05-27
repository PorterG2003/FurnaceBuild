import { useMemo } from 'react';
import { View } from 'react-native';
import type { LeadsColumnDef } from '@/lib/leads/columns';
import type { LeadsTableRow } from '@/lib/leads/columns';
import {
  buildLeadsWorkbenchActionGroups,
  buildLeadsWorkbenchScopeLabel,
} from '@/lib/leads/workbench/buildLeadsWorkbenchActionGroups';
import { LeadsActionBar } from './LeadsActionBar';
import { LeadsWorkbenchTable } from './LeadsWorkbenchTable';

export function LeadsWorkbenchWorkspace({
  columns,
  rows,
  selectedKeys,
  onSelectionChange,
  onMoveColumnLeft,
  onMoveColumnRight,
  onAddToCampaign,
  onPause,
  onResume,
  onRemove,
  onAddToList,
  onRemoveFromList,
  onClearSelection,
  onRowPress,
  selectAllScope = 'page',
  pagination = true,
  paginationMode = 'server',
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
  loading = false,
  loadingMode = 'refresh',
  smoothLoading = true,
}: {
  columns: LeadsColumnDef[];
  rows: LeadsTableRow[];
  selectedKeys: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onMoveColumnLeft: (columnId: string) => void;
  onMoveColumnRight: (columnId: string) => void;
  onAddToCampaign: () => void;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
  onAddToList: () => void;
  onRemoveFromList: () => void;
  onClearSelection: () => void;
  onRowPress?: (row: LeadsTableRow) => void;
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
  loading?: boolean;
  loadingMode?: 'initial' | 'refresh';
  smoothLoading?: boolean;
}) {
  const actionContext = useMemo(
    () => ({
      kind: 'listSelection' as const,
      selectedCount: selectedKeys.size,
      onAddToCampaign,
      onAddToList,
      onRemoveFromList,
      onPause,
      onResume,
      onRemoveFromCampaigns: onRemove,
    }),
    [
      onAddToCampaign,
      onAddToList,
      onPause,
      onRemove,
      onRemoveFromList,
      onResume,
      selectedKeys.size,
    ],
  );

  const groups = useMemo(() => buildLeadsWorkbenchActionGroups(actionContext), [actionContext]);
  const scopeLabel = buildLeadsWorkbenchScopeLabel(actionContext);

  return (
    <View className="gap-4">
      <LeadsActionBar
        scopeLabel={scopeLabel}
        groups={groups}
        onClearSelection={onClearSelection}
        actionsAccessibilityLabel={`Actions for ${selectedKeys.size} selected leads`}
      />
      <LeadsWorkbenchTable
        rows={rows}
        columns={columns}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        onMoveColumnLeft={onMoveColumnLeft}
        onMoveColumnRight={onMoveColumnRight}
        onRowPress={onRowPress}
        plainColumnHeaders
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
        loading={loading}
        loadingMode={loadingMode}
        smoothLoading={smoothLoading}
      />
    </View>
  );
}
