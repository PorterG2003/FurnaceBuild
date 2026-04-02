import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import { DedupeMergeModal } from '@/components/foundry/dedupe/DedupeMergeModal';
import { DedupeDeleteDialog } from '@/components/foundry/dedupe/DedupeDeleteDialog';
import { DedupeEntityOwnersFiltersModal } from '@/components/foundry/dedupe/DedupeEntityOwnersFiltersModal';
import { DedupeManualToolbar } from '@/components/foundry/dedupe/DedupeManualToolbar';
import { EntityOwnerDedupeTable } from '@/components/foundry/dedupe/EntityOwnerDedupeTable';
import {
  buildEntityOwnerMergePayload,
  entityOwnerMergeFields,
  getEntityOwnerValueMatrix,
  getSelectedDeleteTargetId,
} from '@/components/foundry/dedupe/dedupeManualActions';
import {
  countManualEntityOwnerFilters,
  DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS,
  presenceFilterToBool,
  type ManualEntityOwnersFilters,
} from '@/components/foundry/dedupe/dedupeManualFilterTypes';
import { useDebouncedValue } from '@/components/foundry/dedupe/useDebouncedValue';
import { fetchManualEntityOwners, postEntityOwnerMerge } from '@/lib/foundry/registry-client';
import type { RegistryEntityOwnerRow } from '@/lib/foundry/registry-types';

const PAGE_SIZE = 50;

function safeTotalCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function ManualEntityOwnersPanel() {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<ManualEntityOwnersFilters>(DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | undefined>('owner');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<RegistryEntityOwnerRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);

  const debouncedQ = useDebouncedValue(searchText.trim(), 350);
  const activeFilterCount = useMemo(() => countManualEntityOwnerFilters(filters), [filters]);

  const apiParams = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      q: debouncedQ.length >= 2 ? debouncedQ : undefined,
      is_current: filters.currentOnly ? true : undefined,
      has_owner_normalized_key: presenceFilterToBool(filters.ownerNormalizedKey),
      state_entity_id: filters.stateEntityId.trim() || undefined,
      sort_by: sortColumn,
      sort_direction: sortDirection,
    }),
    [debouncedQ, filters, page, sortColumn, sortDirection],
  );

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchManualEntityOwners(apiParams);
      setRows(response.entity_owners);
      setTotalCount(safeTotalCount(response.total_count));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contacts');
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [apiParams]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [page]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedKeys.has(row.id)), [rows, selectedKeys]);
  const deleteTargetId = getSelectedDeleteTargetId(selectedRows);
  const valueMatrix = useMemo(() => getEntityOwnerValueMatrix(selectedRows), [selectedRows]);

  const resultSummary = `Showing ${rows.length} of ${safeTotalCount(totalCount)} contacts`;
  const validationHint =
    searchText.trim().length > 0 && debouncedQ.length < 2 ? '· type at least 2 characters to search by owner name' : null;

  const refresh = useCallback(() => {
    void loadPage();
  }, [loadPage]);

  const handleMergeConfirm = useCallback(
    async (merged: Record<string, string>, survivorIdx: number) => {
      const payload = buildEntityOwnerMergePayload(selectedRows, merged, survivorIdx);
      if (!payload) return;
      setMergeBusy(true);
      setError(null);
      try {
        await postEntityOwnerMerge(payload);
        setMergeOpen(false);
        setSelectedKeys(new Set());
        void loadPage();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Merge failed');
      } finally {
        setMergeBusy(false);
      }
    },
    [loadPage, selectedRows],
  );

  return (
    <>
      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <DedupeManualToolbar
        searchLabel="Owner name"
        searchPlaceholder="Search contacts (min 2 characters)"
        searchText={searchText}
        onSearchTextChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        onOpenFilters={() => setFiltersOpen(true)}
        onRefresh={refresh}
        activeFilterCount={activeFilterCount}
        refreshing={loading}
        resultSummary={resultSummary}
        validationHint={validationHint}
      />

      <View className="flex-row flex-wrap gap-2 mb-3">
        <Button variant="default" size="sm" disabled={selectedRows.length < 2} onPress={() => setMergeOpen(true)}>
          Merge selected
        </Button>
        <Button variant="destructive" size="sm" disabled={!deleteTargetId} onPress={() => setDeleteOpen(true)}>
          Delete selected
        </Button>
      </View>

      <EntityOwnerDedupeTable
        rows={rows}
        loading={loading}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        emptyMessage={loading ? 'Loading contacts…' : 'No contacts match these filters.'}
        currentPage={page}
        totalItems={safeTotalCount(totalCount)}
        onPageChange={setPage}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={(columnKey, direction) => {
          setSortColumn(columnKey);
          setSortDirection(direction);
          setPage(1);
        }}
      />

      <DedupeEntityOwnersFiltersModal
        visible={filtersOpen}
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onClose={() => setFiltersOpen(false)}
        onClear={() => {
          setFilters(DEFAULT_MANUAL_ENTITY_OWNERS_FILTERS);
          setPage(1);
        }}
      />

      <DedupeMergeModal
        visible={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge contacts (owners)"
        columnLabels={selectedRows.map((row) => row.owner_name.slice(0, 48))}
        fields={entityOwnerMergeFields}
        valueMatrix={valueMatrix}
        onConfirm={handleMergeConfirm}
        busy={mergeBusy}
      />

      <DedupeDeleteDialog
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        mode="entity_owner"
        targetId={deleteTargetId}
        onDeleted={() => {
          setDeleteOpen(false);
          setSelectedKeys(new Set());
          void loadPage();
        }}
      />
    </>
  );
}
