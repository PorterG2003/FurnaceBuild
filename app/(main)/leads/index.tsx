import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { FunnelIcon, MagnifyingGlassIcon, QueueListIcon } from 'react-native-heroicons/outline';
import { PageLayout, PageHeader, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, usePageSkeleton, useToast } from '@/components/ui/feedback';
import { LeadsExplorerSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { BottomSheet } from '@/components/ui/modals/BottomSheet';
import { useAccountBootstrap } from '@/lib/account/useAccountBootstrap';
import {
  countActiveExplorerFilters,
  EMPTY_EXPLORER_FILTERS,
  LeadsAddToCampaignModal,
  LeadsCreateListFromSelectionModal,
  LeadsExplorerFiltersModal,
  LeadsActionBar,
  LeadsImportCsvModal,
  LeadsListMembershipModal,
  LeadsPauseMembershipsModal,
  LeadsRemoveMembershipsModal,
  LeadsResumeMembershipsModal,
  LeadsSaveViewAsListModal,
  LeadsWorkbenchTable,
  type ListMembershipMode,
  type ListMembershipScope,
  type ListMembershipSuccessResult,
} from '@/components/leads/workbench';
import {
  EXPLORER_COLUMNS,
} from '@/lib/leads/columns';
import { getCampaignTags, type CampaignTag } from '@/lib/supabase/services/campaign-tags';
import {
  buildExplorerRows,
  getAccountLeadCampaigns,
  getAccountLeadPeoplePage,
} from '@/lib/supabase/services/leads/account-leads';
import { openLeadDetail } from '@/lib/leads/navigation';
import {
  buildLeadsWorkbenchActionGroups,
  buildLeadsWorkbenchScopeLabel,
} from '@/lib/leads/workbench/buildLeadsWorkbenchActionGroups';
import type { LeadsListDefinition, LeadsPeopleRow } from '@/lib/devtools/leads-workbench/types';
import type { AccountLeadExplorerQuery } from '@/lib/supabase/services/leads/account-leads';

const MOBILE_EXPLORER_PAGE_SIZE = 20;
const DESKTOP_EXPLORER_PAGE_SIZE = 25;

export default function LeadsIndexPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { accountId, isAccountBootstrapping, accountBootstrapError } = useAccountBootstrap();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<LeadsListDefinition['filters']>({
    ...EMPTY_EXPLORER_FILTERS,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [listMembershipModal, setListMembershipModal] = useState<{
    mode: ListMembershipMode;
    scope: ListMembershipScope;
    scopeLabel: string;
  } | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [campaigns, setCampaigns] = useState<Awaited<ReturnType<typeof getAccountLeadCampaigns>>>([]);
  const [accountCampaignTags, setAccountCampaignTags] = useState<CampaignTag[]>([]);
  const [rows, setRows] = useState<ReturnType<typeof buildExplorerRows>>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DESKTOP_EXPLORER_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [sortColumn, setSortColumn] = useState<string>('rollup-activity');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const { showPlaceholder } = usePageSkeleton(isAccountBootstrapping || (loading && !hasLoadedOnce));

  const explorerList = useMemo<LeadsListDefinition>(
    () => ({
      id: 'explorer',
      name: 'Leads Explorer',
      description: 'Default searchable and filterable view across mock people.',
      columns: EXPLORER_COLUMNS,
      filters: {
        ...appliedFilters,
        searchQuery,
      },
      updatedAt: new Date().toISOString(),
    }),
    [appliedFilters, searchQuery]
  );

  const activeFilterCount = countActiveExplorerFilters(explorerList.filters);
  const selectedGlobalLeadIds = useMemo(
    () => [...selectedKeys],
    [selectedKeys],
  );
  const explorerQuery = useMemo<Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>>(
    () => ({
      searchQuery: explorerList.filters.searchQuery,
      campaignIds: explorerList.filters.campaignIds,
      campaignTagIds: explorerList.filters.campaignTagIds,
      replyStatuses: explorerList.filters.replyStatuses,
      enrollmentStates: explorerList.filters.enrollmentStates ?? explorerList.filters.statuses,
      replyCategories: explorerList.filters.replyCategories,
      sortColumn,
      sortDirection,
    }),
    [explorerList.filters, sortColumn, sortDirection],
  );

  useEffect(() => {
    setPageSize(isMobile ? MOBILE_EXPLORER_PAGE_SIZE : DESKTOP_EXPLORER_PAGE_SIZE);
  }, [isMobile]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, searchQuery, pageSize, sortColumn, sortDirection]);

  useEffect(() => {
    if (!accountId) {
      setCampaigns([]);
      setAccountCampaignTags([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [nextCampaigns, nextTags] = await Promise.all([
          getAccountLeadCampaigns(accountId),
          getCampaignTags(accountId),
        ]);
        if (!cancelled) {
          setCampaigns(nextCampaigns);
          setAccountCampaignTags(nextTags);
        }
      } catch {
        if (!cancelled) {
          setCampaigns([]);
          setAccountCampaignTags([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (isAccountBootstrapping) {
      setLoading(true);
      setError(null);
      return;
    }

    if (accountBootstrapError) {
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      setError(accountBootstrapError);
      return;
    }

    if (!accountId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await getAccountLeadPeoplePage(accountId, {
          searchQuery: explorerList.filters.searchQuery,
          campaignIds: explorerList.filters.campaignIds,
          campaignTagIds: explorerList.filters.campaignTagIds,
          replyStatuses: explorerList.filters.replyStatuses,
          enrollmentStates: explorerList.filters.enrollmentStates ?? explorerList.filters.statuses,
          replyCategories: explorerList.filters.replyCategories,
          limit: pageSize,
          offset: (currentPage - 1) * pageSize,
          sortColumn,
          sortDirection,
        });

        if (!cancelled) {
          setRows(buildExplorerRows(result.rows, explorerList));
          setTotalCount(result.totalCount);
          setHasLoadedOnce(true);
        }
      } catch (nextError) {
        if (!cancelled) {
          setRows([]);
          setTotalCount(0);
          setError(nextError instanceof Error ? nextError.message : 'Failed to load leads.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accountBootstrapError,
    accountId,
    currentPage,
    explorerList,
    isAccountBootstrapping,
    pageSize,
    refreshNonce,
    sortColumn,
    sortDirection,
  ]);

  useEffect(() => {
    setSelectedKeys((current) => new Set([...current].filter((key) => rows.some((row) => row.globalLeadId === key))));
  }, [rows]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [appliedFilters, currentPage, searchQuery, pageSize, sortColumn, sortDirection]);

  const openImportCsv = useCallback(() => {
    if (isMobile) return;
    setImportCsvOpen(true);
  }, [isMobile]);

  const handleListCreated = useCallback((listId: string) => {
    setSelectedKeys(new Set());
    toast.success('Created saved list.');
    router.push(`/leads/lists/${listId}`);
  }, [router, toast]);

  const handleEnrollmentActionSuccess = useCallback(
    (kind: 'pause' | 'resume', result: { affected: number; skipped: number }) => {
      const parts = [
        result.affected > 0
          ? `${result.affected} ${kind === 'pause' ? 'paused' : 'resumed'}`
          : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? parts.join(', ') : `${kind === 'pause' ? 'Pause' : 'Resume'} finished.`);
      setSelectedKeys(new Set());
      setRefreshNonce((nonce) => nonce + 1);
    },
    [toast],
  );

  const handleRemoveSuccess = useCallback(
    (result: { removed: number; skipped: number }) => {
      const parts = [
        result.removed > 0 ? `${result.removed} removed` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? parts.join(', ') : 'Remove finished.');
      setSelectedKeys(new Set());
      setRefreshNonce((nonce) => nonce + 1);
    },
    [toast],
  );

  const handleAddToCampaignSuccess = useCallback(
    (result: { created: number; updated: number; skipped: number; failed: number }) => {
      const parts = [
        result.created > 0 ? `${result.created} added` : null,
        result.updated > 0 ? `${result.updated} updated` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
        result.failed > 0 ? `${result.failed} failed` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? parts.join(', ') : 'Add to campaign finished.');
    },
    [toast],
  );

  const handleListMembershipSuccess = useCallback(
    (result: ListMembershipSuccessResult) => {
      if ('added' in result) {
        const parts = [
          result.added > 0 ? `${result.added} added` : null,
          result.skippedAlreadyMember > 0 ? `${result.skippedAlreadyMember} already in list` : null,
          result.skippedInvalid > 0 ? `${result.skippedInvalid} skipped` : null,
        ].filter(Boolean);
        toast.success(parts.length > 0 ? parts.join(', ') : 'Add to list finished.');
      } else if ('skippedNotMember' in result) {
        const parts = [
          result.removed > 0 ? `${result.removed} removed from list` : null,
          result.skippedNotMember > 0 ? `${result.skippedNotMember} skipped` : null,
        ].filter(Boolean);
        toast.success(parts.length > 0 ? parts.join(', ') : 'Remove from list finished.');
      } else {
        toast.success(
          result.removed > 0 ? `${result.removed} removed from list` : 'Remove from list finished.',
        );
      }
      setSelectedKeys(new Set());
      setRefreshNonce((nonce) => nonce + 1);
    },
    [toast],
  );

  const openListMembership = useCallback(
    (params: { mode: ListMembershipMode; scope: ListMembershipScope; scopeLabel: string }) => {
      setListMembershipModal(params);
    },
    [],
  );

  const handleRowPress = useCallback(
    (row: LeadsPeopleRow) => {
      void openLeadDetail(router, { globalLeadId: row.globalLeadId, from: 'explorer' });
    },
    [router],
  );

  const explorerActionContext = useMemo(() => {
    if (selectedKeys.size > 0) {
      return {
        kind: 'explorerSelection' as const,
        selectedCount: selectedKeys.size,
        onAddToCampaign: () => setAddToCampaignOpen(true),
        onAddToList: () =>
          openListMembership({
            mode: 'add',
            scope: 'selection',
            scopeLabel: `${selectedKeys.size} selected`,
          }),
        onPause: () => setPauseOpen(true),
        onResume: () => setResumeOpen(true),
        onRemoveFromCampaigns: () => setRemoveOpen(true),
        onRemoveFromList: () =>
          openListMembership({
            mode: 'remove',
            scope: 'selection',
            scopeLabel: `${selectedKeys.size} selected`,
          }),
        onCreateListFromSelection: () => setCreateListOpen(true),
      };
    }
    return {
      kind: 'explorerView' as const,
      matchingCount: totalCount,
      onSaveViewAsList: () => setSaveViewOpen(true),
      onAddViewToList: () =>
        openListMembership({
          mode: 'add',
          scope: 'explorerView',
          scopeLabel: `${totalCount.toLocaleString()} in view`,
        }),
      onRemoveViewFromList: () =>
        openListMembership({
          mode: 'remove',
          scope: 'explorerView',
          scopeLabel: `${totalCount.toLocaleString()} in view`,
        }),
    };
  }, [openListMembership, selectedKeys.size, totalCount]);

  const explorerActionGroups = useMemo(
    () => buildLeadsWorkbenchActionGroups(explorerActionContext),
    [explorerActionContext],
  );
  const explorerScopeLabel = buildLeadsWorkbenchScopeLabel(explorerActionContext);

  const headerActions = isMobile ? (
    <MobileHeaderButton
      variant="actions"
      onPress={() => setMobileActionsOpen(true)}
      accessibilityLabel="Leads actions"
    />
  ) : (
    <View className="flex-row gap-2">
      <Button variant="secondary" size="sm" onPress={() => router.push('/leads/lists')}>
        Saved lists
      </Button>
      <Button variant="secondary" size="sm" onPress={openImportCsv}>
        Import CSV
      </Button>
    </View>
  );

  return (
    <PageLayout>
      <PageHeader
        title="Leads"
        subtitle={
          isMobile
            ? 'Browse and filter leads across campaigns.'
            : 'Browse account-wide leads, filter the explorer, import a CSV, or create a static list from selected rows.'
        }
        primaryAction={headerActions}
      />

      <View className="gap-3">
        {error && !isAccountBootstrapping ? (
          <Alert variant="error" message={error} />
        ) : null}

        {showPlaceholder ? (
          <LeadsExplorerSkeleton isMobile={isMobile} />
        ) : (
          <>
            <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
              <View
                className="flex-1 flex-row items-center rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5"
                style={{ borderWidth: 1, minWidth: 0 }}
              >
                <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search by email, name, or company"
                  placeholderTextColor="#6B7280"
                  className="flex-1 text-white font-instrument text-base py-0"
                  style={{ minHeight: 24 }}
                />
              </View>
              <View className="relative" style={{ flexShrink: 0 }}>
                <IconButton
                  icon={FunnelIcon}
                  variant="secondary"
                  size="sm"
                  matchButtonPadding="sm"
                  className="!h-11 !w-11 !bg-[#1A1A1A] !border-[#2A2A2A]"
                  accessibilityLabel="Lead filters"
                  onPress={() => setFiltersOpen(true)}
                />
                {activeFilterCount > 0 ? (
                  <View className="absolute -top-1 -right-1 min-w-[18px] min-h-[18px] px-1 items-center justify-center rounded-full bg-brand-orange border border-[#1A1A1A]">
                    <Text className="text-white font-instrument-semibold text-[10px] leading-none">
                      {activeFilterCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {!isMobile ? (
              <LeadsActionBar
                scopeLabel={explorerScopeLabel}
                groups={explorerActionGroups}
                onClearSelection={selectedKeys.size > 0 ? () => setSelectedKeys(new Set()) : undefined}
                actionsAccessibilityLabel={
                  selectedKeys.size > 0
                    ? `Actions for ${selectedKeys.size} selected leads`
                    : 'Actions for filtered view'
                }
              />
            ) : null}

            <LeadsWorkbenchTable
              rows={rows}
              columns={EXPLORER_COLUMNS}
              selectedKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              onMoveColumnLeft={() => {}}
              onMoveColumnRight={() => {}}
              selectable={!isMobile}
              allowColumnReorder={false}
              plainColumnHeaders
              selectAllScope="page"
              paginationMode="server"
              currentPage={currentPage}
              totalItems={totalCount}
              itemsPerPage={pageSize}
              onPageChange={setCurrentPage}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChange={(columnKey, direction) => {
                setSortColumn(columnKey);
                setSortDirection(direction);
              }}
              onRowPress={handleRowPress}
              loading={loading}
              loadingMode={hasLoadedOnce ? 'refresh' : 'initial'}
            />
          </>
        )}
      </View>

      <LeadsExplorerFiltersModal
        visible={filtersOpen}
        filters={explorerList.filters}
        campaigns={campaigns}
        accountCampaignTags={accountCampaignTags}
        onApply={setAppliedFilters}
        onClear={() => setAppliedFilters({ ...EMPTY_EXPLORER_FILTERS })}
        onClose={() => setFiltersOpen(false)}
      />

      <LeadsImportCsvModal
        visible={importCsvOpen}
        onClose={() => setImportCsvOpen(false)}
        onCreated={handleListCreated}
      />

      <LeadsCreateListFromSelectionModal
        visible={createListOpen}
        selectedGlobalLeadIds={selectedGlobalLeadIds}
        onClose={() => setCreateListOpen(false)}
        onCreated={handleListCreated}
      />

      <LeadsAddToCampaignModal
        visible={addToCampaignOpen}
        globalLeadIds={selectedGlobalLeadIds}
        scopeLabel={`${selectedKeys.size} selected`}
        onClose={() => setAddToCampaignOpen(false)}
        onSuccess={handleAddToCampaignSuccess}
      />

      <LeadsPauseMembershipsModal
        visible={pauseOpen}
        globalLeadIds={selectedGlobalLeadIds}
        scopeLabel={`${selectedKeys.size} selected`}
        onClose={() => setPauseOpen(false)}
        onSuccess={(result) => handleEnrollmentActionSuccess('pause', result)}
      />

      <LeadsResumeMembershipsModal
        visible={resumeOpen}
        globalLeadIds={selectedGlobalLeadIds}
        scopeLabel={`${selectedKeys.size} selected`}
        onClose={() => setResumeOpen(false)}
        onSuccess={(result) => handleEnrollmentActionSuccess('resume', result)}
      />

      <LeadsRemoveMembershipsModal
        visible={removeOpen}
        globalLeadIds={selectedGlobalLeadIds}
        scopeLabel={`${selectedKeys.size} selected`}
        onClose={() => setRemoveOpen(false)}
        onSuccess={handleRemoveSuccess}
      />

      <LeadsSaveViewAsListModal
        visible={saveViewOpen}
        explorerQuery={explorerQuery}
        matchingCount={totalCount}
        onClose={() => setSaveViewOpen(false)}
        onCreated={handleListCreated}
      />

      {!isMobile && listMembershipModal ? (
        <LeadsListMembershipModal
          visible
          mode={listMembershipModal.mode}
          scope={listMembershipModal.scope}
          globalLeadIds={selectedGlobalLeadIds}
          explorerQuery={listMembershipModal.scope === 'explorerView' ? explorerQuery : undefined}
          matchingCount={listMembershipModal.scope === 'explorerView' ? totalCount : undefined}
          scopeLabel={listMembershipModal.scopeLabel}
          memberSource="selection"
          onClose={() => setListMembershipModal(null)}
          onSuccess={handleListMembershipSuccess}
        />
      ) : null}

      {isMobile ? (
        <BottomSheet visible={mobileActionsOpen} onClose={() => setMobileActionsOpen(false)}>
          <Pressable
            onPress={() => {
              setMobileActionsOpen(false);
              router.push('/leads/lists');
            }}
            accessibilityRole="button"
            accessibilityLabel="Saved lists"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 14,
            }}
          >
            <QueueListIcon size={20} color="#9CA3AF" />
            <Text className="text-white font-instrument-medium text-base">Saved lists</Text>
          </Pressable>
        </BottomSheet>
      ) : null}
    </PageLayout>
  );
}
