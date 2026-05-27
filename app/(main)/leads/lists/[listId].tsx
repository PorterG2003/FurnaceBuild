import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FunnelIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { DetailPageShell, LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { Alert, EmptyState, usePageSkeleton, useToast } from '@/components/ui/feedback';
import { SavedListDetailSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useAccount } from '@/contexts/AccountContext';
import {
  countActiveExplorerFilters,
  EMPTY_EXPLORER_FILTERS,
  LeadsAddToCampaignModal,
  LeadsExplorerFiltersModal,
  LeadsActionBar,
  LeadsListMembershipModal,
  LeadsPauseMembershipsModal,
  LeadsRemoveMembershipsModal,
  LeadsResumeMembershipsModal,
  LeadsWorkbenchTable,
  LeadsWorkbenchWorkspace,
  LEADS_DESKTOP_ONLY_MESSAGE,
  type ListMembershipMode,
  type ListMembershipScope,
  type ListMembershipSuccessResult,
} from '@/components/leads/workbench';
import { ColumnLayoutSaveIndicator } from '@/components/leads/workbench/ColumnLayoutSaveIndicator';
import { LeadsEditColumnsModal } from '@/components/leads/workbench/LeadsEditColumnsModal';
import type { AddGlobalLeadsToCampaignResult } from '@/lib/supabase/services/leads/add-to-campaign';
import {
  DEFAULT_SAVED_LIST_COLUMNS,
  buildSavedListPeopleRows,
  columnsNeedWorkbenchDataset,
  layoutNeedsReplyActivity,
  useAutoSaveColumnLayout,
  type LeadsColumnDef,
  type LeadsTableRow,
} from '@/lib/leads/columns';
import { openLeadDetail } from '@/lib/leads/navigation';
import {
  buildLeadsWorkbenchActionGroups,
  buildLeadsWorkbenchScopeLabel,
} from '@/lib/leads/workbench/buildLeadsWorkbenchActionGroups';
import { getCampaignTags, type CampaignTag } from '@/lib/supabase/services/campaign-tags';
import { getAccountLeadCampaigns, getAccountLeadWorkbenchDataset } from '@/lib/supabase/services/leads/account-leads';
import {
  getSavedLeadListMetadata,
  getSavedLeadListPeoplePage,
  type SavedLeadListMetadata,
  type SavedLeadListPeopleQuery,
} from '@/lib/supabase/services/leads/saved-lists';
import type { LeadsListDefinition, LeadsWorkbenchDataset, MockCampaign } from '@/lib/devtools/leads-workbench/types';

const pageSize = 50;

function moveColumn(columns: LeadsColumnDef[], columnId: string, direction: -1 | 1) {
  const visibleColumns = columns.filter((column) => column.visible);
  const currentVisibleIndex = visibleColumns.findIndex((column) => column.id === columnId);
  const nextVisibleIndex = currentVisibleIndex + direction;
  if (currentVisibleIndex === -1 || nextVisibleIndex < 0 || nextVisibleIndex >= visibleColumns.length) {
    return columns;
  }

  const source = visibleColumns[currentVisibleIndex]!;
  const target = visibleColumns[nextVisibleIndex]!;
  const sourceIndex = columns.findIndex((column) => column.id === source.id);
  const targetIndex = columns.findIndex((column) => column.id === target.id);
  if (sourceIndex === -1 || targetIndex === -1) return columns;

  const next = [...columns];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex]!, next[sourceIndex]!];
  return next;
}

export default function LeadsWorkbenchPage() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { account } = useAccount();
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const [listMetadata, setListMetadata] = useState<SavedLeadListMetadata | null>(null);
  const [campaigns, setCampaigns] = useState<MockCampaign[]>([]);
  const [dataset, setDataset] = useState<LeadsWorkbenchDataset>({ campaigns: [], people: [] });
  const [columns, setColumns] = useState<LeadsColumnDef[]>(DEFAULT_SAVED_LIST_COLUMNS);
  const [rows, setRows] = useState<LeadsTableRow[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pauseOpen, setPauseOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [enrollmentActionLeadIds, setEnrollmentActionLeadIds] = useState<string[]>([]);
  const [enrollmentActionScopeLabel, setEnrollmentActionScopeLabel] = useState('');
  const [peopleRefreshNonce, setPeopleRefreshNonce] = useState(0);
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);
  const [addToCampaignLeadIds, setAddToCampaignLeadIds] = useState<string[]>([]);
  const [addToCampaignSavedListId, setAddToCampaignSavedListId] = useState<string | null>(null);
  const [addToCampaignScopeLabel, setAddToCampaignScopeLabel] = useState('');
  const [listMembershipModal, setListMembershipModal] = useState<{
    mode: ListMembershipMode;
    scope: ListMembershipScope;
    scopeLabel: string;
  } | null>(null);
  const [metadataRefreshNonce, setMetadataRefreshNonce] = useState(0);
  const [editColumnsOpen, setEditColumnsOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPeople, setTotalPeople] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<LeadsListDefinition['filters']>({
    ...EMPTY_EXPLORER_FILTERS,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accountCampaignTags, setAccountCampaignTags] = useState<CampaignTag[]>([]);
  const [sortColumn, setSortColumn] = useState<string>('rollup-activity');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [hasInitialLoadCompleted, setHasInitialLoadCompleted] = useState(false);

  const listFilters = useMemo<LeadsListDefinition['filters']>(
    () => ({
      ...appliedFilters,
      searchQuery,
    }),
    [appliedFilters, searchQuery],
  );

  const activeFilterCount = countActiveExplorerFilters(listFilters);
  const hasActiveListFilters =
    activeFilterCount > 0 || searchQuery.trim().length > 0;
  const showFilteredListRemove =
    hasActiveListFilters &&
    totalPeople > 0 &&
    listMetadata !== null &&
    totalPeople < listMetadata.leadCount;

  const listPeopleQuery = useMemo<Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>>(
    () => ({
      searchQuery: listFilters.searchQuery,
      campaignIds: listFilters.campaignIds,
      campaignTagIds: listFilters.campaignTagIds,
      replyStatuses: listFilters.replyStatuses,
      enrollmentStates: listFilters.enrollmentStates ?? listFilters.statuses,
      replyCategories: listFilters.replyCategories,
      sortColumn,
      sortDirection,
    }),
    [listFilters, sortColumn, sortDirection],
  );

  const handleSortChange = useCallback((columnKey: string, direction: 'asc' | 'desc') => {
    setSortColumn(columnKey);
    setSortDirection(direction);
  }, []);

  const { saveStatus, markLoaded, resetLoaded } = useAutoSaveColumnLayout({
    accountId: account?.id,
    listId,
    columns,
    enabled: !isMobile && Boolean(listMetadata),
  });

  useEffect(() => {
    if (!account?.id || !listId) {
      setListMetadata(null);
      setError('No active account or list selected.');
      resetLoaded();
      return;
    }

    let cancelled = false;
    setMetadataLoading(true);
    setError(null);
    resetLoaded();

    void (async () => {
      try {
        const nextMetadata = await getSavedLeadListMetadata(account.id, listId);
        if (!cancelled) {
          if (!nextMetadata) {
            setListMetadata(null);
            setError('Saved list not found.');
            return;
          }
          setListMetadata(nextMetadata);
          setColumns(nextMetadata.columnLayout);
          markLoaded(nextMetadata.columnLayout);
        }
      } catch (nextError) {
        if (!cancelled) {
          setListMetadata(null);
          setError(nextError instanceof Error ? nextError.message : 'Failed to load saved list.');
        }
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, listId, markLoaded, metadataRefreshNonce, resetLoaded]);

  useEffect(() => {
    if (!account?.id) {
      setCampaigns([]);
      setAccountCampaignTags([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [nextCampaigns, nextTags] = await Promise.all([
          getAccountLeadCampaigns(account.id),
          getCampaignTags(account.id),
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
  }, [account?.id]);

  useEffect(() => {
    setCurrentPage(1);
    setSearchQuery('');
    setAppliedFilters({ ...EMPTY_EXPLORER_FILTERS });
    setSortColumn('rollup-activity');
    setSortDirection('desc');
    setHasInitialLoadCompleted(false);
  }, [listId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [appliedFilters, searchQuery, sortColumn, sortDirection]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [appliedFilters, currentPage, searchQuery, sortColumn, sortDirection]);

  useEffect(() => {
    if (!account?.id || !listId || !listMetadata) {
      setRows([]);
      setDataset({ campaigns: [], people: [] });
      setTotalPeople(0);
      return;
    }

    let cancelled = false;
    setPeopleLoading(true);

    void (async () => {
      try {
        const peoplePage = await getSavedLeadListPeoplePage(account.id, listId, {
          ...listPeopleQuery,
          limit: pageSize,
          offset: (currentPage - 1) * pageSize,
        });

        const pageGlobalLeadIds = peoplePage.rows.map((row) => row.globalLeadId).filter(Boolean);
        const needsWorkbench = columnsNeedWorkbenchDataset(columns);

        const nextDataset =
          needsWorkbench && pageGlobalLeadIds.length > 0
            ? await getAccountLeadWorkbenchDataset(account.id, pageGlobalLeadIds, {
                includeReplyActivity: layoutNeedsReplyActivity(columns),
              })
            : { campaigns: [], people: [] };

        const nextRows = buildSavedListPeopleRows({
          columns,
          pageRows: peoplePage.rows,
          workbenchPeople: nextDataset.people,
        });

        if (!cancelled) {
          setDataset(nextDataset);
          setRows(nextRows);
          setTotalPeople(peoplePage.totalCount);
          setHasInitialLoadCompleted(true);
        }
      } catch (nextError) {
        if (!cancelled) {
          setRows([]);
          setDataset({ campaigns: [], people: [] });
          setError(nextError instanceof Error ? nextError.message : 'Failed to load list members.');
        }
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, columns, currentPage, listId, listMetadata, listPeopleQuery, peopleRefreshNonce]);

  useEffect(() => {
    setSelectedKeys((current) => new Set([...current].filter((key) => rows.some((row) => row.globalLeadId === key))));
  }, [rows]);

  const openEnrollmentAction = useCallback(
    (kind: 'pause' | 'resume', params: { globalLeadIds: string[]; scopeLabel: string }) => {
      setEnrollmentActionLeadIds(params.globalLeadIds);
      setEnrollmentActionScopeLabel(params.scopeLabel);
      if (kind === 'pause') setPauseOpen(true);
      else setResumeOpen(true);
    },
    [],
  );

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
      setPeopleRefreshNonce((nonce) => nonce + 1);
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
      setPeopleRefreshNonce((nonce) => nonce + 1);
    },
    [toast],
  );

  const openAddToCampaign = useCallback(
    (params: { globalLeadIds?: string[]; savedListId?: string; scopeLabel: string }) => {
      setAddToCampaignLeadIds(params.globalLeadIds ?? []);
      setAddToCampaignSavedListId(params.savedListId ?? null);
      setAddToCampaignScopeLabel(params.scopeLabel);
      setAddToCampaignOpen(true);
    },
    [],
  );

  const handleAddToCampaignSuccess = useCallback(
    (result: AddGlobalLeadsToCampaignResult) => {
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
        if (result.removed > 0 && listMetadata && result.removed >= listMetadata.leadCount) {
          toast.info('This list is now empty.');
        }
      } else {
        toast.success(
          result.removed > 0 ? `${result.removed} removed from list` : 'Remove from list finished.',
        );
        if (result.removed > 0) {
          toast.info('This list is now empty.');
        }
      }
      setSelectedKeys(new Set());
      setPeopleRefreshNonce((nonce) => nonce + 1);
      setMetadataRefreshNonce((nonce) => nonce + 1);
    },
    [listMetadata, toast],
  );

  const openListMembership = useCallback(
    (params: { mode: ListMembershipMode; scope: ListMembershipScope; scopeLabel: string }) => {
      setListMembershipModal(params);
    },
    [],
  );

  const handleRowPress = useCallback(
    (row: LeadsTableRow) => {
      if (!listId) return;
      void openLeadDetail(router, {
        globalLeadId: row.globalLeadId,
        from: 'list',
        listId,
        listName: listMetadata?.name,
      });
    },
    [listId, listMetadata?.name, router],
  );

  const handleSaveColumns = useCallback((nextColumns: LeadsColumnDef[]) => {
    setColumns(nextColumns);
  }, []);

  const handleExport = useCallback(() => {
    if (isMobile) return;
    toast.info('Export is not wired in this slice yet.');
  }, [isMobile, toast]);

  const listViewActionContext = useMemo(() => {
    if (!listMetadata) return null;
    return {
      kind: 'listView' as const,
      leadCount: listMetadata.leadCount,
      filteredCount: totalPeople,
      hasActiveFilters: hasActiveListFilters,
      onAddAllToCampaign: () =>
        openAddToCampaign({
          savedListId: listId,
          scopeLabel: `${listMetadata.leadCount.toLocaleString()} in list`,
        }),
      onRemoveAllFromList: () =>
        openListMembership({
          mode: 'remove',
          scope: 'listAll',
          scopeLabel: `${listMetadata.leadCount.toLocaleString()} in list`,
        }),
      onRemoveFilteredFromList: showFilteredListRemove
        ? () =>
            openListMembership({
              mode: 'remove',
              scope: 'listFiltered',
              scopeLabel: `${totalPeople.toLocaleString()} in filtered view`,
            })
        : undefined,
    };
  }, [
    hasActiveListFilters,
    listId,
    listMetadata,
    openAddToCampaign,
    openListMembership,
    showFilteredListRemove,
    totalPeople,
  ]);

  const listViewActionGroups = useMemo(
    () => (listViewActionContext ? buildLeadsWorkbenchActionGroups(listViewActionContext) : []),
    [listViewActionContext],
  );
  const listViewScopeLabel = listViewActionContext
    ? buildLeadsWorkbenchScopeLabel(listViewActionContext)
    : null;

  const isInitialPageLoad = !hasInitialLoadCompleted && !error;
  const isTableRefresh = hasInitialLoadCompleted && peopleLoading;
  const { showPlaceholder } = usePageSkeleton(isInitialPageLoad);
  const tableLoading = isInitialPageLoad || isTableRefresh;
  const tableLoadingMode = hasInitialLoadCompleted ? 'refresh' : 'initial';

  const headerActions = (
    <View className="flex-row items-center gap-3">
      <ColumnLayoutSaveIndicator status={saveStatus} />
      <Button variant="secondary" size="sm" onPress={() => setEditColumnsOpen(true)}>
        Edit columns
      </Button>
      <Button variant="secondary" size="sm" onPress={handleExport}>
        Export
      </Button>
    </View>
  );

  return (
    <DetailPageShell
      breadcrumbItems={[
        { label: 'Leads', href: '/leads' },
        { label: 'Saved lists', href: '/leads/lists' },
        { label: showPlaceholder ? 'Saved list' : (listMetadata?.name ?? 'Saved list') },
      ]}
      backHref="/leads/lists"
      title={showPlaceholder ? 'Saved list' : (listMetadata?.name ?? 'Saved list')}
      subtitle={showPlaceholder ? undefined : listMetadata?.description}
      actions={showPlaceholder || isMobile ? undefined : headerActions}
    >
      <View className="gap-6">
        {error ? <Alert variant="error" message={error} /> : null}

        {!showPlaceholder && !error && !listMetadata ? (
          <EmptyState
            title="List not found"
            description="This saved list could not be found for the current account."
          />
        ) : null}

        {showPlaceholder ? (
          <SavedListDetailSkeleton
            isMobile={isMobile}
            titleWidth={listMetadata?.name ? Math.min(listMetadata.name.length * 9, 240) : 180}
            subtitleWidth={listMetadata?.description ? Math.min(listMetadata.description.length * 6, 320) : 240}
          />
        ) : null}

        {!showPlaceholder && !error && listMetadata ? (
          <>
            {isMobile ? <Alert variant="info" message={LEADS_DESKTOP_ONLY_MESSAGE} /> : null}

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

            {!isMobile && selectedKeys.size === 0 && totalPeople > 0 ? (
              <LeadsActionBar
                scopeLabel={listViewScopeLabel}
                groups={listViewActionGroups}
                actionsAccessibilityLabel="Actions for list view"
              />
            ) : null}

            {isMobile ? (
              <LeadsWorkbenchTable
                rows={rows}
                columns={columns}
                selectedKeys={new Set()}
                onSelectionChange={() => {}}
                onMoveColumnLeft={() => {}}
                onMoveColumnRight={() => {}}
                selectable={false}
                allowColumnReorder={false}
                plainColumnHeaders
                paginationMode="server"
                currentPage={currentPage}
                totalItems={totalPeople}
                itemsPerPage={pageSize}
                onPageChange={setCurrentPage}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                onRowPress={handleRowPress}
                loading={tableLoading}
                loadingMode={tableLoadingMode}
              />
            ) : (
              <LeadsWorkbenchWorkspace
                columns={columns}
                rows={rows}
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                selectAllScope="page"
                paginationMode="server"
                currentPage={currentPage}
                totalItems={totalPeople}
                itemsPerPage={pageSize}
                onPageChange={setCurrentPage}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                onMoveColumnLeft={(columnId) => {
                  setColumns((current) => moveColumn(current, columnId, -1));
                }}
                onMoveColumnRight={(columnId) => {
                  setColumns((current) => moveColumn(current, columnId, 1));
                }}
                onAddToCampaign={() =>
                  openAddToCampaign({
                    globalLeadIds: [...selectedKeys],
                    scopeLabel: `${selectedKeys.size} selected`,
                  })
                }
                onAddToList={() =>
                  openListMembership({
                    mode: 'add',
                    scope: 'selection',
                    scopeLabel: `${selectedKeys.size} selected`,
                  })
                }
                onPause={() =>
                  openEnrollmentAction('pause', {
                    globalLeadIds: [...selectedKeys],
                    scopeLabel: `${selectedKeys.size} selected`,
                  })
                }
                onResume={() =>
                  openEnrollmentAction('resume', {
                    globalLeadIds: [...selectedKeys],
                    scopeLabel: `${selectedKeys.size} selected`,
                  })
                }
                onRemove={() => setRemoveOpen(true)}
                onRemoveFromList={() =>
                  openListMembership({
                    mode: 'remove',
                    scope: 'selection',
                    scopeLabel: `${selectedKeys.size} selected`,
                  })
                }
                onClearSelection={() => setSelectedKeys(new Set())}
                onRowPress={handleRowPress}
                loading={tableLoading}
                loadingMode={tableLoadingMode}
              />
            )}

            <LeadsExplorerFiltersModal
              visible={filtersOpen}
              filters={listFilters}
              campaigns={campaigns}
              accountCampaignTags={accountCampaignTags}
              onApply={setAppliedFilters}
              onClear={() => setAppliedFilters({ ...EMPTY_EXPLORER_FILTERS })}
              onClose={() => setFiltersOpen(false)}
            />

            {!isMobile ? (
              <>
                <LeadsEditColumnsModal
                  visible={editColumnsOpen}
                  campaigns={campaigns}
                  columns={columns}
                  onClose={() => setEditColumnsOpen(false)}
                  onSaveColumns={handleSaveColumns}
                />
                <LeadsAddToCampaignModal
                  visible={addToCampaignOpen}
                  globalLeadIds={addToCampaignLeadIds}
                  savedListId={addToCampaignSavedListId}
                  scopeLabel={addToCampaignScopeLabel}
                  onClose={() => setAddToCampaignOpen(false)}
                  onSuccess={handleAddToCampaignSuccess}
                />
                <LeadsPauseMembershipsModal
                  visible={pauseOpen}
                  globalLeadIds={enrollmentActionLeadIds}
                  scopeLabel={enrollmentActionScopeLabel}
                  onClose={() => setPauseOpen(false)}
                  onSuccess={(result) => handleEnrollmentActionSuccess('pause', result)}
                />
                <LeadsResumeMembershipsModal
                  visible={resumeOpen}
                  globalLeadIds={enrollmentActionLeadIds}
                  scopeLabel={enrollmentActionScopeLabel}
                  onClose={() => setResumeOpen(false)}
                  onSuccess={(result) => handleEnrollmentActionSuccess('resume', result)}
                />
                <LeadsRemoveMembershipsModal
                  visible={removeOpen}
                  globalLeadIds={[...selectedKeys]}
                  scopeLabel={`${selectedKeys.size} selected`}
                  onClose={() => setRemoveOpen(false)}
                  onSuccess={handleRemoveSuccess}
                />
                {listMembershipModal ? (
                  <LeadsListMembershipModal
                    visible
                    mode={listMembershipModal.mode}
                    scope={listMembershipModal.scope}
                    globalLeadIds={[...selectedKeys]}
                    listPeopleQuery={
                      listMembershipModal.scope === 'listFiltered' ? listPeopleQuery : undefined
                    }
                    targetListId={
                      listMembershipModal.mode === 'remove' ? listId : null
                    }
                    excludeListId={
                      listMembershipModal.mode === 'add' ? listId : null
                    }
                    matchingCount={
                      listMembershipModal.scope === 'listAll'
                        ? listMetadata?.leadCount
                        : listMembershipModal.scope === 'listFiltered'
                          ? totalPeople
                          : undefined
                    }
                    scopeLabel={listMembershipModal.scopeLabel}
                    listName={listMetadata?.name}
                    memberSource="manual"
                    onClose={() => setListMembershipModal(null)}
                    onSuccess={handleListMembershipSuccess}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </DetailPageShell>
  );
}
