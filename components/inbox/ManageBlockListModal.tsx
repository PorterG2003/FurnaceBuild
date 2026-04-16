import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Tabs } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/Toggle';
import type { BlockListEntry } from '@/lib/supabase/types';
import { getBlockListPage } from '@/lib/supabase/services/block-list';

const PENDING_UNBLOCK_RESET_MS = 4000;
const TAB_LIST = 'list';
const TAB_SETTINGS = 'settings';

export interface ManageBlockListModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  onUnblock: (entryId: string) => Promise<void>;
  unblockingId: string | null;
  /** When provided, Settings tab shows "Automatically block bounced emails" toggle. */
  suppressBouncedEmails?: boolean;
  onSuppressBouncedChange?: (value: boolean) => Promise<void>;
  savingSuppressBounced?: boolean;
  isOwner?: boolean;
}

export function ManageBlockListModal({
  visible,
  onClose,
  accountId,
  onUnblock,
  unblockingId,
  suppressBouncedEmails = true,
  onSuppressBouncedChange,
  savingSuppressBounced = false,
  isOwner = false,
}: ManageBlockListModalProps) {
  const [activeTab, setActiveTab] = useState(TAB_LIST);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BlockListEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | undefined>('value');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const pageSize = 25;

  useEffect(() => {
    if (!visible) setActiveTab(TAB_LIST);
  }, [visible]);

  useEffect(() => {
    if (!visible) setPendingUnblockId(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [searchQuery, visible]);

  useEffect(() => {
    if (!pendingUnblockId) return;
    const t = setTimeout(() => setPendingUnblockId(null), PENDING_UNBLOCK_RESET_MS);
    return () => clearTimeout(t);
  }, [pendingUnblockId]);

  const loadPage = useCallback(async () => {
    if (!visible || activeTab !== TAB_LIST) return;
    setLoadingRows(true);
    try {
      const result = await getBlockListPage(accountId, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search: debouncedSearchQuery || undefined,
        sortBy:
          sortColumn === 'value' || sortColumn === 'type' || sortColumn === 'reason'
            ? sortColumn
            : 'created_at',
        sortDirection,
      });
      setRows(result.entries);
      setTotalCount(result.totalCount);
    } finally {
      setLoadingRows(false);
    }
  }, [accountId, activeTab, debouncedSearchQuery, page, sortColumn, sortDirection, visible]);

  const handleUnblockPress = useCallback(
    (entry: BlockListEntry) => {
      if (pendingUnblockId === entry.id) {
        void onUnblock(entry.id).then(() => {
          void loadPage();
        });
        setPendingUnblockId(null);
      } else {
        setPendingUnblockId(entry.id);
      }
    },
    [loadPage, pendingUnblockId, onUnblock]
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const emptyMessage =
    totalCount === 0 && !debouncedSearchQuery
      ? 'No blocked entries.'
      : `No results for "${debouncedSearchQuery}"`;

  const columns: TableColumn<BlockListEntry>[] = useMemo(
    () => [
      {
        key: 'value',
        label: 'Value',
        flex: 2,
        sortable: true,
        sortValue: (e) => e.value.toLowerCase(),
        render: (entry) => (
          <Text className="text-white text-sm font-instrument" numberOfLines={1}>
            {entry.value}
          </Text>
        ),
      },
      {
        key: 'type',
        label: 'Type',
        flex: 1,
        sortable: true,
        sortValue: (e) => e.type,
        render: (entry) => (
          <View
            className={`rounded px-1.5 py-0.5 self-start ${
              entry.type === 'email' ? 'bg-amber-500/20' : 'bg-blue-500/20'
            }`}
          >
            <Text
              className={`text-xs font-instrument-medium ${
                entry.type === 'email' ? 'text-amber-400' : 'text-blue-400'
              }`}
            >
              {entry.type === 'email' ? 'Email' : 'Domain'}
            </Text>
          </View>
        ),
      },
      {
        key: 'reason',
        label: 'Reason',
        flex: 1,
        sortable: true,
        sortValue: (e) => e.reason ?? '',
        render: (entry) => (
          <Text className="text-gray-400 text-sm font-instrument">
            {entry.reason === 'bounced'
              ? 'Bounced'
              : entry.reason === 'manual'
                ? 'Manual'
                : entry.reason === 'unsubscribed'
                  ? 'Unsubscribed'
                  : '—'}
          </Text>
        ),
      },
      {
        key: 'actions',
        label: '',
        flex: 1,
        render: (entry) => (
          <Button
            variant="secondary"
            size="xs"
            onPress={() => handleUnblockPress(entry)}
            disabled={unblockingId === entry.id}
            className="self-start"
          >
            {unblockingId === entry.id
              ? 'Unblocking...'
              : pendingUnblockId === entry.id
                ? 'Click again to confirm'
                : 'Unblock'}
          </Button>
        ),
      },
    ],
    [pendingUnblockId, unblockingId, handleUnblockPress]
  );

  const tabs = useMemo(
    () => [
      { id: TAB_LIST, label: 'List' },
      { id: TAB_SETTINGS, label: 'Settings' },
    ],
    []
  );

  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Manage Block List"
      description="Blocked addresses and domains do not receive automated campaign emails. You can still reply manually from the inbox."
      maxWidth="4xl"
      maxHeight={720}
    >
      <View className="gap-4">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          layout={isMobile ? 'equal' : 'content'}
          marginBottom={isMobile ? 0 : 16}
        />

        {activeTab === TAB_SETTINGS && (
          <View className="bg-[#121212] border border-[#2A2A2A] rounded-lg p-4">
            {onSuppressBouncedChange ? (
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <Text className="text-white text-sm font-instrument mb-0.5">
                    Automatically block bounced emails
                  </Text>
                  <Text className="text-gray-500 text-xs font-instrument">
                    When on, hard bounces are added to the block list automatically.
                  </Text>
                </View>
                <Toggle
                  value={suppressBouncedEmails}
                  onValueChange={onSuppressBouncedChange}
                  disabled={savingSuppressBounced || !isOwner}
                />
              </View>
            ) : (
              <Text className="text-gray-400 text-sm font-instrument">
                No block list settings available for this account.
              </Text>
            )}
          </View>
        )}

        {activeTab === TAB_LIST && (
          <>
            <View className="flex-row items-center rounded-lg bg-[#121212] border border-[#2A2A2A] px-3 py-2">
              <MagnifyingGlassIcon size={18} color="#6B7280" style={{ marginRight: 8 }} />
              <TextInput
                value={searchQuery}
                onChangeText={(value) => {
                  setSearchQuery(value);
                  setPage(1);
                }}
                placeholder="Search blocked entries..."
                placeholderTextColor="#6B7280"
                className="flex-1 text-white font-instrument text-sm py-1"
                style={{ color: '#FFFFFF' }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <ScrollView
              style={{ maxHeight: 460 }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              <DataTable<BlockListEntry>
                items={rows}
                columns={columns}
                getItemKey={(e) => e.id}
                emptyMessage={emptyMessage}
                loading={loadingRows}
                pagination
                paginationMode="server"
                currentPage={page}
                totalItems={totalCount}
                onPageChange={setPage}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSortChange={(columnKey, direction) => {
                  setSortColumn(columnKey);
                  setSortDirection(direction);
                  setPage(1);
                }}
              />
            </ScrollView>
          </>
        )}
      </View>
    </BaseModal>
  );
}
