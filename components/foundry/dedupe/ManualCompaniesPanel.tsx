import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { DedupeMergeModal } from '@/components/foundry/dedupe/DedupeMergeModal';
import { DedupeDeleteDialog } from '@/components/foundry/dedupe/DedupeDeleteDialog';
import { CompanyDedupeTable } from '@/components/foundry/dedupe/CompanyDedupeTable';
import { DedupeCompaniesFiltersModal } from '@/components/foundry/dedupe/DedupeCompaniesFiltersModal';
import { DedupeManualToolbar } from '@/components/foundry/dedupe/DedupeManualToolbar';
import {
  buildCompanyMergePayload,
  buildCompanyMergeReadOnlyRows,
  companyMergeFields,
  getCompanyValueMatrix,
  getSelectedDeleteTargetId,
  loadCompanyMergePreviewDetails,
} from '@/components/foundry/dedupe/dedupeManualActions';
import {
  countManualCompaniesFilters,
  DEFAULT_MANUAL_COMPANIES_FILTERS,
  presenceFilterToBool,
  type ManualCompaniesFilters,
} from '@/components/foundry/dedupe/dedupeManualFilterTypes';
import { useDebouncedValue } from '@/components/foundry/dedupe/useDebouncedValue';
import { fetchManualCompanies, postCompanyMerge } from '@/lib/foundry/registry-client';
import type { ParsedCompanyDetail, RegistryCompany } from '@/lib/foundry/registry-types';

const PAGE_SIZE = 50;

function safeTotalCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function ManualCompaniesPanel() {
  const router = useRouter();
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<ManualCompaniesFilters>(DEFAULT_MANUAL_COMPANIES_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | undefined>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<RegistryCompany[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergePreviewDetails, setMergePreviewDetails] = useState<ParsedCompanyDetail[] | null>(null);
  const [mergePreviewError, setMergePreviewError] = useState<string | null>(null);

  const debouncedQ = useDebouncedValue(searchText.trim(), 350);
  const activeFilterCount = useMemo(() => countManualCompaniesFilters(filters), [filters]);

  const apiParams = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      q: debouncedQ.length >= 2 ? debouncedQ : undefined,
      has_normalized_key: presenceFilterToBool(filters.normalizedKey),
      has_notes: presenceFilterToBool(filters.notes),
      sort_by: sortColumn,
      sort_direction: sortDirection,
    }),
    [debouncedQ, filters, page, sortColumn, sortDirection],
  );

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchManualCompanies(apiParams);
      setRows(response.companies);
      setTotalCount(safeTotalCount(response.total_count));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load companies');
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
  const valueMatrix = useMemo(() => getCompanyValueMatrix(selectedRows), [selectedRows]);
  const mergeReadOnlyRows = useMemo(
    () => buildCompanyMergeReadOnlyRows(selectedRows, mergePreviewLoading, mergePreviewDetails),
    [mergePreviewDetails, mergePreviewLoading, selectedRows],
  );

  useEffect(() => {
    if (!mergeOpen || selectedRows.length < 2) {
      setMergePreviewLoading(false);
      setMergePreviewDetails(null);
      setMergePreviewError(null);
      return;
    }

    let cancelled = false;
    setMergePreviewLoading(true);
    setMergePreviewError(null);
    setMergePreviewDetails(null);

    void loadCompanyMergePreviewDetails(selectedRows.map((row) => row.id))
      .then((details) => {
        if (cancelled) return;
        setMergePreviewDetails(details);
        setMergePreviewLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setMergePreviewError(e instanceof Error ? e.message : 'Failed to load merge preview');
        setMergePreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mergeOpen, selectedRows]);

  const resultSummary = `Showing ${rows.length} of ${safeTotalCount(totalCount)} companies`;
  const validationHint =
    searchText.trim().length > 0 && debouncedQ.length < 2 ? '· type at least 2 characters to search by company name' : null;

  const refresh = useCallback(() => {
    void loadPage();
  }, [loadPage]);

  const handleMergeConfirm = useCallback(
    async (merged: Record<string, string>, survivorIdx: number) => {
      const payload = buildCompanyMergePayload(selectedRows, merged, survivorIdx);
      if (!payload) return;
      setMergeBusy(true);
      setError(null);
      try {
        await postCompanyMerge(payload);
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
        searchLabel="Company name"
        searchPlaceholder="Search companies (min 2 characters)"
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

      <CompanyDedupeTable
        rows={rows}
        loading={loading}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        onRowPress={(company) => router.push(`/foundry/companies/${company.id}`)}
        emptyMessage={loading ? 'Loading companies…' : 'No companies match these filters.'}
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

      <DedupeCompaniesFiltersModal
        visible={filtersOpen}
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onClose={() => setFiltersOpen(false)}
        onClear={() => {
          setFilters(DEFAULT_MANUAL_COMPANIES_FILTERS);
          setPage(1);
        }}
      />

      <DedupeMergeModal
        visible={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge companies"
        columnLabels={selectedRows.map((row) => row.legal_name.slice(0, 48))}
        fields={companyMergeFields}
        valueMatrix={valueMatrix}
        onConfirm={handleMergeConfirm}
        busy={mergeBusy}
        readOnlyRows={mergeReadOnlyRows}
        readOnlyBannerError={mergePreviewError}
      />

      <DedupeDeleteDialog
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        mode="company"
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
