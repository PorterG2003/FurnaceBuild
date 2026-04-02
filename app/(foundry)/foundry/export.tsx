import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Text, TextInput, ActivityIndicator, Platform, Alert, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import {
  collectExportCompanyChainPeopleForCsv,
  collectExportCompanyOwnerLeadsForCsv,
  fetchExportCompanyChainPeople,
  fetchExportCompanyOwnerLeads,
  type ExportCompanyChainPeopleParams,
  type ExportCompanyOwnerLeadsParams,
} from '@/lib/foundry/registry-client';
import type { ExportCompanyChainPeopleRow, ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';
import type { ExportReadyFilter, ExportTriFilter } from '@/components/foundry/export/exportFilterTypes';
import { countNonDefaultExportFilters } from '@/components/foundry/export/exportFilterTypes';
import { ExportFiltersModal } from '@/components/foundry/export/ExportFiltersModal';
import { ExportOptionsModal, type ExportOptionsState } from '@/components/foundry/export/ExportOptionsModal';
import {
  chainPeopleRowsToPreviewRows,
  ExportPreviewTable,
  ownerLeadRowsToPreviewRows,
} from '@/components/foundry/export/ExportPreviewTable';
import { mergeExportChainPeopleRows } from '@/components/foundry/export/exportChainPeopleMerge';
import {
  downloadCsvOnWeb,
  exportCompanyChainPeopleToCsv,
  exportCompanyOwnerLeadsToCsv,
} from '@/components/foundry/export/exportLeadsCsv';

function triToParam(v: ExportTriFilter): boolean | undefined {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

function safeTotalCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function SetupSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1">
      <Text className="text-gray-500 font-instrument text-[11px] uppercase tracking-wider">{label}</Text>
      <Text className="text-gray-200 font-instrument text-sm leading-5">{value}</Text>
    </View>
  );
}

export default function FoundryExportScreen() {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [registryState, setRegistryState] = useState('');
  const [exportReady, setExportReady] = useState<ExportReadyFilter>('ready');
  const [linkedFilter, setLinkedFilter] = useState<ExportTriFilter>('any');
  const [ownerFilter, setOwnerFilter] = useState<ExportTriFilter>('any');
  const [reviewFilter, setReviewFilter] = useState<ExportTriFilter>('any');
  const [parseFilter, setParseFilter] = useState<ExportTriFilter>('any');
  const [exportOptions, setExportOptions] = useState<ExportOptionsState>({
    mode: 'owner_rows',
    mergePeoplePerCompany: false,
    chainMaxDepth: 6,
  });

  const [rows, setRows] = useState<ExportCompanyOwnerLeadRow[]>([]);
  const [chainRows, setChainRows] = useState<ExportCompanyChainPeopleRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [targetsReturned, setTargetsReturned] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const activeFilterCount = useMemo(
    () =>
      countNonDefaultExportFilters({
        exportReady,
        registryState,
        linkedFilter,
        ownerFilter,
        reviewFilter,
        parseFilter,
      }),
    [exportReady, registryState, linkedFilter, ownerFilter, reviewFilter, parseFilter],
  );

  const baseApiParams = useMemo((): Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'> => {
    const p: Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'> = {};
    if (debouncedQ.length >= 2) p.q = debouncedQ;
    const st = registryState.trim();
    if (st) p.registry_state = st;
    if (exportReady === 'ready') p.is_export_ready = true;
    else if (exportReady === 'blocked') p.is_export_ready = false;
    const l = triToParam(linkedFilter);
    if (l !== undefined) p.has_current_linked_source = l;
    const o = triToParam(ownerFilter);
    if (o !== undefined) p.has_current_owner = o;
    const r = triToParam(reviewFilter);
    if (r !== undefined) p.has_open_review_task = r;
    const pf = triToParam(parseFilter);
    if (pf !== undefined) p.has_parse_failure_task = pf;
    return p;
  }, [debouncedQ, registryState, exportReady, linkedFilter, ownerFilter, reviewFilter, parseFilter]);
  const chainApiParams = useMemo(
    (): Omit<ExportCompanyChainPeopleParams, 'limit' | 'offset'> => ({
      ...baseApiParams,
      max_depth: exportOptions.chainMaxDepth,
    }),
    [baseApiParams, exportOptions.chainMaxDepth],
  );
  const isChainMode = exportOptions.mode === 'chain_people';
  const apiParamsKey = useMemo(
    () =>
      JSON.stringify({
        mode: exportOptions.mode,
        chainMaxDepth: exportOptions.chainMaxDepth,
        baseApiParams,
      }),
    [baseApiParams, exportOptions.chainMaxDepth, exportOptions.mode],
  );
  const previousApiParamsKeyRef = useRef<string | null>(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCsvMsg(null);
    try {
      if (isChainMode) {
        const res = await fetchExportCompanyChainPeople({
          ...chainApiParams,
          limit: 50,
          offset: (page - 1) * 50,
        });
        setChainRows(res.rows);
        setRows([]);
        setTargetsReturned(safeTotalCount(res.targets_returned));
        setTotalCount(safeTotalCount(res.total_count));
      } else {
        const res = await fetchExportCompanyOwnerLeads({
          ...baseApiParams,
          limit: 50,
          offset: (page - 1) * 50,
        });
        setRows(res.rows);
        setChainRows([]);
        setTargetsReturned(0);
        setTotalCount(safeTotalCount(res.total_count));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : isChainMode
            ? 'Failed to load chain-linked people export data'
            : 'Failed to load export data',
      );
      setRows([]);
      setChainRows([]);
      setTargetsReturned(0);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [baseApiParams, chainApiParams, isChainMode, page]);

  useEffect(() => {
    const paramsChanged = previousApiParamsKeyRef.current !== apiParamsKey;
    if (paramsChanged && page !== 1) {
      previousApiParamsKeyRef.current = apiParamsKey;
      setPage(1);
      return;
    }
    previousApiParamsKeyRef.current = apiParamsKey;
    void loadPage();
  }, [apiParamsKey, loadPage, page]);

  const previewRows = useMemo(
    () =>
      isChainMode
        ? chainPeopleRowsToPreviewRows(chainRows, exportOptions.mergePeoplePerCompany)
        : ownerLeadRowsToPreviewRows(rows),
    [chainRows, exportOptions.mergePeoplePerCompany, isChainMode, rows],
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(safeTotalCount(totalCount) / 50)), [totalCount]);

  const previewModeLabel = isChainMode
    ? exportOptions.mergePeoplePerCompany
      ? `Chain-linked people, merged per company/person (depth ${exportOptions.chainMaxDepth})`
      : `Chain-linked people, one row per company/person path (depth ${exportOptions.chainMaxDepth})`
    : 'Registry owner rows, one row per current owner record';

  const rangeLabel = useMemo(() => {
    if (isChainMode) {
      const rowLabel = exportOptions.mergePeoplePerCompany ? 'merged person row' : 'chain row';
      const targetLabel = `${safeTotalCount(totalCount)} matching company target${safeTotalCount(totalCount) === 1 ? '' : 's'}`;
      const rowCountLabel = `${previewRows.length} ${rowLabel}${previewRows.length === 1 ? '' : 's'} on this page`;
      const expandedLabel =
        targetsReturned > 0 ? ` · ${targetsReturned} target${targetsReturned === 1 ? '' : 's'} expanded` : '';
      return `${targetLabel} · ${rowCountLabel}${expandedLabel}`;
    }

    return `${safeTotalCount(totalCount)} matching owner row${safeTotalCount(totalCount) === 1 ? '' : 's'} · ${previewRows.length} shown on this page`;
  }, [exportOptions.mergePeoplePerCompany, isChainMode, previewRows.length, targetsReturned, totalCount]);

  const setupSummary = useMemo(
    () => ({
      format: isChainMode ? 'Company targets expanded into people through ownership chains.' : 'Current registry owner rows on each exportable company target.',
      rowGrain: isChainMode
        ? exportOptions.mergePeoplePerCompany
          ? 'Preview and CSV collapse duplicate names within the same company after chain expansion.'
          : 'Preview and CSV keep one row per company/person path discovered during chain expansion.'
        : 'Preview and CSV keep one row per current owner record, with company-scoped contact fields attached.',
      contacts:
        'Addresses and websites are company-scoped fields carried with every exported row, regardless of whether the export is owner-based or chain-based.',
    }),
    [exportOptions.mergePeoplePerCompany, isChainMode],
  );

  const applyExportOptions = useCallback((next: ExportOptionsState) => {
    setExportOptions(next);
  }, []);

  const onDownloadCsv = useCallback(async (nextOptions: ExportOptionsState) => {
    setExportOptions(nextOptions);
    setExportOptionsOpen(false);
    if (Platform.OS !== 'web') {
      Alert.alert('CSV export', 'CSV download is available when you open Foundry Export in a desktop browser.');
      return;
    }
    setCsvBusy(true);
    setCsvMsg(null);
    setError(null);
    try {
      const d = new Date().toISOString().slice(0, 10);
      if (nextOptions.mode === 'chain_people') {
        const activeChainParams: Omit<ExportCompanyChainPeopleParams, 'limit' | 'offset'> = {
          ...baseApiParams,
          max_depth: nextOptions.chainMaxDepth,
        };
        const { rows: allRows, truncated, total_count } = await collectExportCompanyChainPeopleForCsv(activeChainParams);
        const finalRows = nextOptions.mergePeoplePerCompany ? mergeExportChainPeopleRows(allRows) : allRows;
        const csv = exportCompanyChainPeopleToCsv(finalRows);
        downloadCsvOnWeb(`foundry-chain-people-export-${d}.csv`, csv);
        setCsvMsg(
          truncated
            ? `Downloaded ${finalRows.length} ${nextOptions.mergePeoplePerCompany ? 'merged people' : 'rows'} (cap reached while scanning ${total_count} company targets).`
            : `Downloaded ${finalRows.length} ${nextOptions.mergePeoplePerCompany ? 'merged person row' : 'row'}${
                finalRows.length === 1 ? '' : 's'
              } from ${total_count} matching company target${
                total_count === 1 ? '' : 's'
              }.`,
        );
      } else {
        const { rows: allRows, truncated, total_count } = await collectExportCompanyOwnerLeadsForCsv(baseApiParams);
        const csv = exportCompanyOwnerLeadsToCsv(allRows);
        downloadCsvOnWeb(`foundry-owner-rows-export-${d}.csv`, csv);
        setCsvMsg(
          truncated
            ? `Downloaded ${allRows.length} rows (cap reached; ${total_count} matched filters).`
            : `Downloaded ${allRows.length} row${allRows.length === 1 ? '' : 's'}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed');
    } finally {
      setCsvBusy(false);
    }
  }, [baseApiParams, chainApiParams]);

  const clearExportFilters = useCallback(() => {
    setRegistryState('');
    setExportReady('ready');
    setLinkedFilter('any');
    setOwnerFilter('any');
    setReviewFilter('any');
    setParseFilter('any');
  }, []);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Export' }]} />
      </View>
      <PageHeader
        title="Export"
        subtitle="Choose a company-scoped export format, preview the resulting rows, and export the final CSV from one place."
      />
      <Link href="/foundry/queue" asChild>
        <Pressable className="mb-4 self-start">
          <Text className="text-brand-orange font-instrument text-sm underline">Open review queue</Text>
        </Pressable>
      </Link>

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {csvMsg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{csvMsg}</Text> : null}

      <View className="mb-3 gap-3">
        <View>
          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Company name</Text>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search (min 2 characters)"
            placeholderTextColor="#6b7280"
            className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#1A1A1A]"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onPress={() => setFiltersOpen(true)} className="self-start">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-white font-instrument-semibold text-sm">Filters</Text>
              {activeFilterCount > 0 ? (
                <View className="bg-brand-orange rounded-full min-w-[20px] px-1.5 py-0.5 items-center justify-center">
                  <Text className="text-white font-instrument-semibold text-xs">{activeFilterCount}</Text>
                </View>
              ) : null}
            </View>
          </Button>
          <Button variant="default" size="sm" disabled={csvBusy} onPress={() => setExportOptionsOpen(true)}>
            {csvBusy ? 'Preparing export…' : 'Export setup'}
          </Button>
          {csvBusy ? <ActivityIndicator color="#f3440d" /> : null}
        </View>
        {debouncedQ.length > 0 && debouncedQ.length < 2 ? (
          <Text className="text-amber-400/90 font-instrument text-xs">
            Type at least 2 characters before company-name search is applied.
          </Text>
        ) : null}
      </View>

      <ExportFiltersModal
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        registryState={registryState}
        onRegistryStateChange={setRegistryState}
        exportReady={exportReady}
        onExportReadyChange={setExportReady}
        linkedFilter={linkedFilter}
        onLinkedFilterChange={setLinkedFilter}
        reviewFilter={reviewFilter}
        onReviewFilterChange={setReviewFilter}
        parseFilter={parseFilter}
        onParseFilterChange={setParseFilter}
        ownerFilter={ownerFilter}
        onOwnerFilterChange={setOwnerFilter}
        onClearFilters={clearExportFilters}
      />

      <ExportOptionsModal
        visible={exportOptionsOpen}
        onClose={() => setExportOptionsOpen(false)}
        options={exportOptions}
        downloading={csvBusy}
        onApply={applyExportOptions}
        onDownload={(next) => void onDownloadCsv(next)}
      />

      <ExportPreviewTable
        rows={previewRows}
        mode={exportOptions.mode}
        loading={loading}
        onRowPress={(row) => router.push(`/foundry/companies/${row.company_id}`)}
        currentPage={page}
        totalPages={totalPages}
        rangeLabel={rangeLabel}
        onPageChange={setPage}
      />
    </ScrollView>
  );
}
