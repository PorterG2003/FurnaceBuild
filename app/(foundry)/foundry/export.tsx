import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Breadcrumb, LAYOUT_BREAKPOINT, PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/Toggle';
import { Tabs } from '@/components/ui/tabs';
import {
  collectExportCompanyChainPeopleForCsv,
  collectExportCompanyOwnerLeadsForCsv,
  collectExportCompanySummaryForCsv,
  fetchExportCompanyChainPeople,
  fetchExportCompanyOwnerLeads,
  fetchExportCompanySummary,
  type ExportCompanyChainPeopleParams,
  type ExportCompanyOwnerLeadsParams,
  type ExportCompanySummaryParams,
} from '@/lib/foundry/registry-client';
import type {
  ExportCompanyChainPeopleRow,
  ExportCompanyOwnerLeadRow,
  ExportCompanySummaryRow,
} from '@/lib/foundry/registry-types';
import {
  countNonDefaultExportFilters,
  DEFAULT_EXPORT_FILTERS,
  sanitizeExportFiltersForMode,
  type ExportFiltersState,
  type ExportPresentationMode,
  type ExportTriFilter,
} from '@/components/foundry/export/exportFilterTypes';
import { ExportFiltersModal } from '@/components/foundry/export/ExportFiltersModal';
import { ExportFiltersPanel } from '@/components/foundry/export/ExportFiltersPanel';
import { ExportColumnsModal } from '@/components/foundry/export/ExportColumnsModal';
import { ExportPreviewTable } from '@/components/foundry/export/ExportPreviewTable';
import { mergeExportChainPeopleRows } from '@/components/foundry/export/exportChainPeopleMerge';
import { exportRowsToCsv, downloadCsvOnWeb } from '@/components/foundry/export/exportLeadsCsv';
import {
  getDefaultExportColumnKeys,
  getRequiredExportIncludes,
} from '@/components/foundry/export/exportColumns';
import {
  normalizeChainPeopleRows,
  normalizeCompanySummaryRows,
  normalizeOwnerLeadRows,
  type ExportRow,
} from '@/components/foundry/export/exportRows';

const EXPORT_STORAGE_KEY = 'foundry-export-session:v3';
const CHAIN_MAX_DEPTH = 6;
const PAGE_SIZE = 50;

function triToParam(v: ExportTriFilter): boolean | undefined {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

function safeTotalCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeRegistryStateFilter(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function readStoredSession(): {
  presentationMode: ExportPresentationMode;
  appliedFilters: ExportFiltersState;
  chainEnabled: boolean;
  mergePeoplePerCompany: boolean;
  includeCost: boolean;
  visibleColumnsByMode: Record<ExportPresentationMode, string[]>;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EXPORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{
      presentationMode: ExportPresentationMode;
      appliedFilters: ExportFiltersState;
      chainEnabled: boolean;
      mergePeoplePerCompany: boolean;
      includeCost: boolean;
      visibleColumnsByMode: Record<ExportPresentationMode, string[]>;
    }>;
    return {
      presentationMode: parsed.presentationMode === 'company' ? 'company' : 'contact',
      appliedFilters: {
        ...DEFAULT_EXPORT_FILTERS,
        ...(parsed.appliedFilters ?? {}),
        registryState: normalizeRegistryStateFilter(parsed.appliedFilters?.registryState),
      },
      chainEnabled: parsed.chainEnabled !== false,
      mergePeoplePerCompany: parsed.mergePeoplePerCompany === true,
      includeCost: parsed.includeCost === true,
      visibleColumnsByMode: {
        contact: parsed.visibleColumnsByMode?.contact?.length
          ? parsed.visibleColumnsByMode.contact
          : getDefaultExportColumnKeys('contact'),
        company: parsed.visibleColumnsByMode?.company?.length
          ? parsed.visibleColumnsByMode.company
          : getDefaultExportColumnKeys('company'),
      },
    };
  } catch {
    return null;
  }
}

function ToolbarToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-1.5 border border-[#2A2A2A] rounded-lg px-2 py-1.5 bg-[#171717]">
      <Text className="text-gray-300 font-instrument text-xs">{label}</Text>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

export default function FoundryExportScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const storedSession = useMemo(() => readStoredSession(), []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [presentationMode, setPresentationMode] = useState<ExportPresentationMode>(
    storedSession?.presentationMode ?? 'contact',
  );
  const [draftFilters, setDraftFilters] = useState<ExportFiltersState>(
    storedSession?.appliedFilters ?? DEFAULT_EXPORT_FILTERS,
  );
  const [appliedFilters, setAppliedFilters] = useState<ExportFiltersState>(
    storedSession?.appliedFilters ?? DEFAULT_EXPORT_FILTERS,
  );
  const [chainEnabled, setChainEnabled] = useState(storedSession?.chainEnabled ?? true);
  const [mergePeoplePerCompany, setMergePeoplePerCompany] = useState(
    storedSession?.mergePeoplePerCompany ?? false,
  );
  const [includeCost, setIncludeCost] = useState(storedSession?.includeCost ?? false);
  const [visibleColumnsByMode, setVisibleColumnsByMode] = useState<Record<ExportPresentationMode, string[]>>(
    storedSession?.visibleColumnsByMode ?? {
      contact: getDefaultExportColumnKeys('contact'),
      company: getDefaultExportColumnKeys('company'),
    },
  );

  const [ownerRows, setOwnerRows] = useState<ExportCompanyOwnerLeadRow[]>([]);
  const [chainRows, setChainRows] = useState<ExportCompanyChainPeopleRow[]>([]);
  const [companyRows, setCompanyRows] = useState<ExportCompanySummaryRow[]>([]);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      presentationMode,
      appliedFilters,
      chainEnabled,
      mergePeoplePerCompany,
      includeCost,
      visibleColumnsByMode,
    };
    window.localStorage.setItem(EXPORT_STORAGE_KEY, JSON.stringify(payload));
  }, [appliedFilters, chainEnabled, includeCost, mergePeoplePerCompany, presentationMode, visibleColumnsByMode]);

  const visibleColumnKeys = visibleColumnsByMode[presentationMode];
  const effectiveFilters = useMemo(
    () => sanitizeExportFiltersForMode(appliedFilters, presentationMode),
    [appliedFilters, presentationMode],
  );
  const activeFilterCount = useMemo(
    () => countNonDefaultExportFilters(appliedFilters, presentationMode),
    [appliedFilters, presentationMode],
  );
  const dataMode = presentationMode === 'company' ? 'company_summary' : chainEnabled ? 'chain_people' : 'owner_rows';
  const exportIncludes = useMemo(
    () => getRequiredExportIncludes(visibleColumnKeys, includeCost),
    [includeCost, visibleColumnKeys],
  );

  const baseApiParams = useMemo(():
    Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset' | 'include_contact' | 'include_contact_confidence' | 'include_cost' | 'include_google_ads_verification'> => {
    const p: Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'> = {};
    if (debouncedQ.length >= 2) p.q = debouncedQ;
    if (effectiveFilters.companyNameQuery.trim().length >= 2) {
      p.legal_name_q = effectiveFilters.companyNameQuery.trim();
    }
    if (effectiveFilters.companyNameBlankFilter === 'yes') {
      p.has_legal_name = false;
    } else if (effectiveFilters.companyNameBlankFilter === 'no') {
      p.has_legal_name = true;
    }
    if (effectiveFilters.registryState.length > 0) p.registry_state = effectiveFilters.registryState;
    if (effectiveFilters.exportReady === 'ready') p.is_export_ready = true;
    else if (effectiveFilters.exportReady === 'blocked') p.is_export_ready = false;
    const l = triToParam(effectiveFilters.linkedFilter);
    if (l !== undefined) p.has_current_linked_source = l;
    const o = triToParam(effectiveFilters.ownerFilter);
    if (o !== undefined) p.has_current_owner = o;
    const r = triToParam(effectiveFilters.reviewFilter);
    if (r !== undefined) p.has_open_review_task = r;
    const pf = triToParam(effectiveFilters.parseFilter);
    if (pf !== undefined) p.has_parse_failure_task = pf;
    const hasWebsite = triToParam(effectiveFilters.hasWebsiteFilter);
    if (hasWebsite !== undefined) p.has_website = hasWebsite;
    const hasNotes = triToParam(effectiveFilters.hasNotesFilter);
    if (hasNotes !== undefined) p.has_company_notes = hasNotes;
    const hasNormalizedKey = triToParam(effectiveFilters.hasNormalizedKeyFilter);
    if (hasNormalizedKey !== undefined) p.has_normalized_key = hasNormalizedKey;
    if (effectiveFilters.addressState.trim()) p.address_state = effectiveFilters.addressState.trim();
    if (effectiveFilters.addressCity.trim()) p.address_city = effectiveFilters.addressCity.trim();
    if (effectiveFilters.postalCode.trim()) p.address_postal_code = effectiveFilters.postalCode.trim();
    if (effectiveFilters.primaryLocationState.trim()) {
      p.primary_location_state = effectiveFilters.primaryLocationState.trim();
    }
    if (effectiveFilters.primaryLocationCity.trim()) {
      p.primary_location_city = effectiveFilters.primaryLocationCity.trim();
    }
    if (presentationMode === 'contact' && effectiveFilters.ownerTitleQuery.trim().length >= 2) {
      p.owner_title_q = effectiveFilters.ownerTitleQuery.trim();
    }
    if (effectiveFilters.googleAdsResult !== 'any') {
      p.google_ads_result = effectiveFilters.googleAdsResult;
    }
    return p;
  }, [debouncedQ, effectiveFilters, presentationMode]);

  const chainApiParams = useMemo(
    (): Omit<ExportCompanyChainPeopleParams, 'limit' | 'offset'> => ({
      ...baseApiParams,
      include_contact: exportIncludes.includeContact ? true : undefined,
      include_contact_confidence: exportIncludes.includeContactConfidence ? true : undefined,
      include_cost: exportIncludes.includeCost ? true : undefined,
      include_google_ads_verification: exportIncludes.includeGoogleAdsVerification ? true : undefined,
      max_depth: CHAIN_MAX_DEPTH,
    }),
    [baseApiParams, exportIncludes],
  );
  const ownerApiParams = useMemo(
    (): Omit<ExportCompanyOwnerLeadsParams, 'limit' | 'offset'> => ({
      ...baseApiParams,
      include_contact: exportIncludes.includeContact ? true : undefined,
      include_contact_confidence: exportIncludes.includeContactConfidence ? true : undefined,
      include_cost: exportIncludes.includeCost ? true : undefined,
      include_google_ads_verification: exportIncludes.includeGoogleAdsVerification ? true : undefined,
    }),
    [baseApiParams, exportIncludes],
  );
  const companyApiParams = useMemo(
    (): Omit<ExportCompanySummaryParams, 'limit' | 'offset'> => ({
      ...baseApiParams,
      include_cost: exportIncludes.includeCost ? true : undefined,
      include_google_ads_verification: exportIncludes.includeGoogleAdsVerification ? true : undefined,
    }),
    [baseApiParams, exportIncludes],
  );
  const apiParamsKey = useMemo(
    () =>
      JSON.stringify({
        presentationMode,
        dataMode,
        includeCost,
        visibleColumnKeys,
        baseApiParams,
      }),
    [
      baseApiParams,
      dataMode,
      includeCost,
      presentationMode,
      visibleColumnKeys,
    ],
  );
  const previousApiParamsKeyRef = useRef<string | null>(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCsvMsg(null);
    try {
      if (dataMode === 'chain_people') {
        const res = await fetchExportCompanyChainPeople({
          ...chainApiParams,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
        setChainRows(res.rows);
        setOwnerRows([]);
        setCompanyRows([]);
        setTargetsReturned(safeTotalCount(res.targets_returned));
        setTotalCount(safeTotalCount(res.total_count));
      } else if (dataMode === 'company_summary') {
        const res = await fetchExportCompanySummary({
          ...companyApiParams,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
        setCompanyRows(res.rows);
        setOwnerRows([]);
        setChainRows([]);
        setTargetsReturned(0);
        setTotalCount(safeTotalCount(res.total_count));
      } else {
        const res = await fetchExportCompanyOwnerLeads({
          ...ownerApiParams,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
        setOwnerRows(res.rows);
        setCompanyRows([]);
        setChainRows([]);
        setTargetsReturned(0);
        setTotalCount(safeTotalCount(res.total_count));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : dataMode === 'chain_people'
            ? 'Failed to load chain-linked people export data'
            : dataMode === 'company_summary'
              ? 'Failed to load company export data'
            : 'Failed to load export data',
      );
      setOwnerRows([]);
      setChainRows([]);
      setCompanyRows([]);
      setTargetsReturned(0);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [chainApiParams, companyApiParams, dataMode, ownerApiParams, page]);

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

  const previewRows = useMemo<ExportRow[]>(() => {
    if (dataMode === 'chain_people') {
      const sourceRows = mergePeoplePerCompany ? mergeExportChainPeopleRows(chainRows) : chainRows;
      return normalizeChainPeopleRows(sourceRows);
    }
    if (dataMode === 'company_summary') {
      return normalizeCompanySummaryRows(companyRows);
    }
    return normalizeOwnerLeadRows(ownerRows);
  }, [chainRows, companyRows, dataMode, mergePeoplePerCompany, ownerRows]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(safeTotalCount(totalCount) / PAGE_SIZE)), [totalCount]);

  const rangeLabel = useMemo(() => {
    if (dataMode === 'chain_people') {
      const rowLabel = mergePeoplePerCompany ? 'merged person row' : 'chain row';
      const targetLabel = `${safeTotalCount(totalCount)} matching company target${safeTotalCount(totalCount) === 1 ? '' : 's'}`;
      const rowCountLabel = `${previewRows.length} ${rowLabel}${previewRows.length === 1 ? '' : 's'} on this page`;
      const expandedLabel =
        targetsReturned > 0 ? ` · ${targetsReturned} target${targetsReturned === 1 ? '' : 's'} expanded` : '';
      return `${targetLabel} · ${rowCountLabel}${expandedLabel}`;
    }

    if (dataMode === 'company_summary') {
      return `${safeTotalCount(totalCount)} matching company row${safeTotalCount(totalCount) === 1 ? '' : 's'} · ${previewRows.length} shown on this page`;
    }

    return `${safeTotalCount(totalCount)} matching owner row${safeTotalCount(totalCount) === 1 ? '' : 's'} · ${previewRows.length} shown on this page`;
  }, [dataMode, mergePeoplePerCompany, previewRows.length, targetsReturned, totalCount]);

  const applyDraftFilters = useCallback(() => {
    setAppliedFilters(sanitizeExportFiltersForMode(draftFilters, presentationMode));
  }, [draftFilters, presentationMode]);

  const clearDraftFilters = useCallback(() => {
    setDraftFilters(DEFAULT_EXPORT_FILTERS);
  }, []);

  const onDownloadCsv = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Alert.alert('CSV export', 'CSV download is available when you open Foundry Export in a desktop browser.');
      return;
    }
    setCsvBusy(true);
    setCsvMsg(null);
    setError(null);
    try {
      const d = new Date().toISOString().slice(0, 10);
      if (dataMode === 'chain_people') {
        const { rows: allRows, truncated, total_count } = await collectExportCompanyChainPeopleForCsv(chainApiParams);
        const mergedRows = mergePeoplePerCompany ? mergeExportChainPeopleRows(allRows) : allRows;
        const csvRows = normalizeChainPeopleRows(mergedRows);
        const csv = exportRowsToCsv(csvRows, visibleColumnKeys, 'contact');
        downloadCsvOnWeb(`foundry-contact-export-${d}.csv`, csv);
        setCsvMsg(
          truncated
            ? `Downloaded ${csvRows.length} rows. Export stopped at the 20,000 row cap while scanning ${total_count} company targets.`
            : `Downloaded ${csvRows.length} row${csvRows.length === 1 ? '' : 's'} from ${total_count} matching company target${
                total_count === 1 ? '' : 's'
              }.`,
        );
      } else if (dataMode === 'company_summary') {
        const { rows: allRows, truncated, total_count } = await collectExportCompanySummaryForCsv(companyApiParams);
        const csvRows = normalizeCompanySummaryRows(allRows);
        const csv = exportRowsToCsv(csvRows, visibleColumnKeys, 'company');
        downloadCsvOnWeb(`foundry-company-export-${d}.csv`, csv);
        setCsvMsg(
          truncated
            ? `Downloaded ${csvRows.length} company rows. Export stopped at the 20,000 row cap while scanning ${total_count} matches.`
            : `Downloaded ${csvRows.length} company row${csvRows.length === 1 ? '' : 's'}.`,
        );
      } else {
        const { rows: allRows, truncated, total_count } = await collectExportCompanyOwnerLeadsForCsv(ownerApiParams);
        const csvRows = normalizeOwnerLeadRows(allRows);
        const csv = exportRowsToCsv(csvRows, visibleColumnKeys, 'contact');
        downloadCsvOnWeb(`foundry-contact-export-${d}.csv`, csv);
        setCsvMsg(
          truncated
            ? `Downloaded ${csvRows.length} rows. Export stopped at the 20,000 row cap while scanning ${total_count} matches.`
            : `Downloaded ${csvRows.length} row${csvRows.length === 1 ? '' : 's'}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV export failed');
    } finally {
      setCsvBusy(false);
    }
  }, [chainApiParams, companyApiParams, dataMode, mergePeoplePerCompany, ownerApiParams, visibleColumnKeys]);

  useEffect(() => {
    setDraftFilters((current) => sanitizeExportFiltersForMode(current, presentationMode));
    setAppliedFilters((current) => sanitizeExportFiltersForMode(current, presentationMode));
  }, [presentationMode]);

  return (
    <View className="flex-1">
      <ExportFiltersModal
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        mode={presentationMode}
        filters={draftFilters}
        onApply={(next) => {
          setDraftFilters(next);
          setAppliedFilters(sanitizeExportFiltersForMode(next, presentationMode));
        }}
        onClearFilters={() => {
          setDraftFilters(DEFAULT_EXPORT_FILTERS);
        }}
      />

      <ExportColumnsModal
        visible={columnsOpen}
        mode={presentationMode}
        selectedKeys={visibleColumnKeys}
        onClose={() => setColumnsOpen(false)}
        onApply={(nextKeys) =>
          setVisibleColumnsByMode((current) => ({
            ...current,
            [presentationMode]: nextKeys,
          }))
        }
      />

      <View className={`flex-1 ${isMobile ? '' : 'flex-row'}`}>
        {!isMobile ? (
          <View
            className="shrink-0 border-r border-[#242424] bg-[#121212]"
            style={{ width: 300, minWidth: 300, maxWidth: 300 }}
          >
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 10, gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <View className="gap-1 pb-1 border-b border-[#252525]">
                <Text className="text-white font-instrument-semibold text-sm">Filters</Text>
                {activeFilterCount > 0 ? (
                  <Text className="text-brand-orange font-instrument text-[10px] uppercase tracking-wider">
                    {activeFilterCount} active
                  </Text>
                ) : (
                  <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider">Draft until Apply</Text>
                )}
              </View>

              <ExportFiltersPanel
                mode={presentationMode}
                filters={draftFilters}
                onChange={setDraftFilters}
                onApply={applyDraftFilters}
                onClear={clearDraftFilters}
              />
            </ScrollView>
          </View>
        ) : null}

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-3">
            <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Export' }]} />
          </View>
          <PageHeader
            title="Export"
            subtitle="Filter matching registry rows, choose columns, and download the current export view."
          />

          <Tabs
            tabs={[
              { id: 'contact', label: 'Contact' },
              { id: 'company', label: 'Company' },
            ]}
            activeTab={presentationMode}
            onTabChange={(id) => setPresentationMode(id as ExportPresentationMode)}
            layout="equal"
            marginBottom={12}
          />

          <Link href="/foundry/queue" asChild>
            <Pressable className="mb-3 self-start">
              <Text className="text-brand-orange font-instrument text-sm underline">Open review queue</Text>
            </Pressable>
          </Link>

          {error ? <Text className="text-red-400 mb-2 font-instrument text-sm">{error}</Text> : null}
          {csvMsg ? <Text className="text-emerald-400/90 mb-2 font-instrument text-sm">{csvMsg}</Text> : null}

          <View className="mb-3 gap-2">
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="sm" onPress={() => setColumnsOpen(true)}>
                Columns
              </Button>
              <Button variant="default" size="sm" disabled={csvBusy} onPress={() => void onDownloadCsv()}>
                {csvBusy ? 'Preparing export…' : 'Export'}
              </Button>
              {isMobile ? (
                <Button variant="secondary" size="sm" onPress={() => setFiltersOpen(true)}>
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-white font-instrument-semibold text-sm">Filters</Text>
                    {activeFilterCount > 0 ? (
                      <View className="bg-brand-orange rounded-full min-w-[18px] px-1.5 py-0.5 items-center justify-center">
                        <Text className="text-white font-instrument-semibold text-[10px]">{activeFilterCount}</Text>
                      </View>
                    ) : null}
                  </View>
                </Button>
              ) : null}
              {presentationMode === 'contact' ? (
                <ToolbarToggle label="Chain" value={chainEnabled} onValueChange={setChainEnabled} />
              ) : null}
              {presentationMode === 'contact' && chainEnabled ? (
                <ToolbarToggle label="Merge" value={mergePeoplePerCompany} onValueChange={setMergePeoplePerCompany} />
              ) : null}
              <ToolbarToggle label="Cost" value={includeCost} onValueChange={setIncludeCost} />
              {presentationMode === 'contact' && chainEnabled ? (
                <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider">
                  Depth {CHAIN_MAX_DEPTH}
                </Text>
              ) : null}
              {csvBusy ? <ActivityIndicator color="#f3440d" /> : null}
            </View>

            <View>
              <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Company name</Text>
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search (min 2 characters)"
                placeholderTextColor="#6b7280"
                className="border border-[#333333] rounded-md px-3 py-2 text-white font-instrument text-sm bg-[#161616]"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {debouncedQ.length > 0 && debouncedQ.length < 2 ? (
              <Text className="text-amber-400/90 font-instrument text-xs">
                Type at least 2 characters before company-name search is applied.
              </Text>
            ) : null}
          </View>

          <ExportPreviewTable
            rows={previewRows}
            mode={presentationMode}
            visibleColumnKeys={visibleColumnKeys}
            loading={loading}
            onRowPress={(row) => router.push(`/foundry/companies/${row.company_id}`)}
            currentPage={page}
            totalPages={totalPages}
            rangeLabel={rangeLabel}
            onPageChange={setPage}
          />
        </ScrollView>
      </View>
    </View>
  );
}
