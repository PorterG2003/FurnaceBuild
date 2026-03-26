import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Text, TextInput, ActivityIndicator, Platform, Alert, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import {
  collectExportCompanyOwnerLeadsForCsv,
  fetchExportCompanyOwnerLeads,
  type ExportCompanyOwnerLeadsParams,
} from '@/lib/foundry/registry-client';
import type { ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';
import type { ExportReadyFilter, ExportTriFilter } from '@/components/foundry/export/exportFilterTypes';
import { countNonDefaultExportFilters } from '@/components/foundry/export/exportFilterTypes';
import { ExportFiltersModal } from '@/components/foundry/export/ExportFiltersModal';
import { ExportLeadsTable } from '@/components/foundry/export/ExportLeadsTable';
import { downloadCsvOnWeb, exportCompanyOwnerLeadsToCsv } from '@/components/foundry/export/exportLeadsCsv';

function triToParam(v: ExportTriFilter): boolean | undefined {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

export default function FoundryExportScreen() {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [registryState, setRegistryState] = useState('');
  const [exportReady, setExportReady] = useState<ExportReadyFilter>('ready');
  const [linkedFilter, setLinkedFilter] = useState<ExportTriFilter>('any');
  const [ownerFilter, setOwnerFilter] = useState<ExportTriFilter>('any');
  const [reviewFilter, setReviewFilter] = useState<ExportTriFilter>('any');
  const [parseFilter, setParseFilter] = useState<ExportTriFilter>('any');

  const [rows, setRows] = useState<ExportCompanyOwnerLeadRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  const rowsRef = useRef<ExportCompanyOwnerLeadRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

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

  const apiParams = useMemo((): Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'> => {
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

  const loadFresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCsvMsg(null);
    try {
      const res = await fetchExportCompanyOwnerLeads({
        ...apiParams,
        limit: 50,
        offset: 0,
      });
      setRows(res.rows);
      setTotalCount(res.total_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load export data');
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [apiParams]);

  useEffect(() => {
    void loadFresh();
  }, [loadFresh]);

  const appendMore = useCallback(async () => {
    if (loading || loadingMore) return;
    const cur = rowsRef.current;
    if (cur.length >= totalCount) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetchExportCompanyOwnerLeads({
        ...apiParams,
        limit: 50,
        offset: cur.length,
      });
      setRows([...cur, ...res.rows]);
      setTotalCount(res.total_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [apiParams, loading, loadingMore, totalCount]);

  const onDownloadCsv = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Alert.alert(
        'CSV export',
        'CSV download is available when you open Foundry Export in a desktop browser.',
      );
      return;
    }
    setCsvBusy(true);
    setCsvMsg(null);
    setError(null);
    try {
      const { rows: allRows, truncated, total_count } = await collectExportCompanyOwnerLeadsForCsv(apiParams);
      const csv = exportCompanyOwnerLeadsToCsv(allRows);
      const d = new Date().toISOString().slice(0, 10);
      downloadCsvOnWeb(`foundry-company-owner-leads-${d}.csv`, csv);
      setCsvMsg(
        truncated
          ? `Downloaded ${allRows.length} rows (cap reached; ${total_count} matched filters).`
          : `Downloaded ${allRows.length} row${allRows.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed');
    } finally {
      setCsvBusy(false);
    }
  }, [apiParams]);

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
        subtitle="Registry-grounded leads: one row per officer/owner on a promoted state-entity match. Use filters to include blocked rows; CSV includes the same quality columns you see here."
      />

      <Text className="text-gray-500 font-instrument text-sm mb-2 leading-5">
        Rows without a current owner still appear when you widen filters—they are not export-ready until an owner exists
        and review tasks are cleared.
      </Text>
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
          <Button variant="default" size="sm" disabled={csvBusy || loading} onPress={() => void onDownloadCsv()}>
            {csvBusy ? 'Preparing CSV…' : 'Download CSV'}
          </Button>
          {csvBusy ? <ActivityIndicator color="#f3440d" /> : null}
        </View>
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

      <Text className="text-gray-400 font-instrument text-sm mb-3">
        Showing {rows.length} of {totalCount} matching rows
        {debouncedQ.length > 0 && debouncedQ.length < 2 ? ' · type at least 2 characters to search by name' : ''}
      </Text>

      <ExportLeadsTable
        rows={rows}
        loading={loading && rows.length === 0}
        onRowPress={(row) => router.push(`/foundry/companies/${row.company_id}`)}
      />

      {rows.length < totalCount ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start mt-4"
          disabled={loadingMore || loading}
          onPress={() => void appendMore()}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </ScrollView>
  );
}
