export interface ViewSelectAllStateInput {
  selectable: boolean;
  selectedKeys?: Set<string> | null;
  scopeKeys: string[];
  selectAllScope: 'page' | 'all';
  isServerPagination: boolean;
  totalItems?: number;
}

function getSafeTotalItems(totalItems: number | undefined, fallbackCount: number): number {
  if (typeof totalItems !== 'number' || !Number.isFinite(totalItems)) return fallbackCount;
  return Math.max(0, Math.floor(totalItems));
}

export function getViewSelectAllState({
  selectable,
  selectedKeys,
  scopeKeys,
  selectAllScope,
  isServerPagination,
  totalItems,
}: ViewSelectAllStateInput): { allSelected: boolean; someSelected: boolean } {
  if (!selectable || selectedKeys == null) {
    return { allSelected: false, someSelected: false };
  }

  if (isServerPagination && selectAllScope === 'all') {
    const totalViewItems = getSafeTotalItems(totalItems, scopeKeys.length);
    if (totalViewItems === 0) {
      return { allSelected: false, someSelected: false };
    }

    const allVisibleSelected = scopeKeys.length > 0 && scopeKeys.every((key) => selectedKeys.has(key));
    const allSelected = allVisibleSelected && selectedKeys.size >= totalViewItems;
    const someSelected = selectedKeys.size > 0 && !allSelected;
    return { allSelected, someSelected };
  }

  const allSelected = scopeKeys.length > 0 && scopeKeys.every((key) => selectedKeys.has(key));
  const someSelected = scopeKeys.some((key) => selectedKeys.has(key)) && !allSelected;
  return { allSelected, someSelected };
}
