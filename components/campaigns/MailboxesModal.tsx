import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { FunnelIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { buildMailboxOverviewColumns } from '@/components/mailboxes';
import { BaseModal, BottomSheet, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/forms';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import { assignMailboxesToCampaign } from '@/lib/supabase/services/campaigns';
import {
  getMailboxOverviewsByAccount,
  type MailboxOverview,
} from '@/lib/supabase/services/mailboxes';

type StatusFilter = 'all' | 'connected' | 'disconnected' | 'error';
type CampaignLoadFilter = 'all' | '0' | '1' | '2+';
type SelectionFilter = 'all' | 'selected' | 'unselected';

const STATUS_ITEMS: { id: StatusFilter; primary: string }[] = [
  { id: 'all', primary: 'All' },
  { id: 'connected', primary: 'Connected' },
  { id: 'disconnected', primary: 'Disconnected' },
  { id: 'error', primary: 'Error' },
];

const CAMPAIGN_LOAD_ITEMS: { id: CampaignLoadFilter; primary: string }[] = [
  { id: 'all', primary: 'All' },
  { id: '0', primary: '0 active campaigns' },
  { id: '1', primary: '1 active campaign' },
  { id: '2+', primary: '2+ active campaigns' },
];

const SELECTION_ITEMS: { id: SelectionFilter; primary: string }[] = [
  { id: 'all', primary: 'All mailboxes' },
  { id: 'selected', primary: 'Selected only' },
  { id: 'unselected', primary: 'Unselected only' },
];

const FILTER_PANEL_SCROLL_MAX = 420;
const FILTER_PANEL_MIN_WIDTH = 300;

function countActiveMailboxFilters(filters: {
  statusFilter: StatusFilter;
  campaignLoadFilter: CampaignLoadFilter;
  selectionFilter: SelectionFilter;
}) {
  return (
    (filters.statusFilter !== 'all' ? 1 : 0) +
    (filters.campaignLoadFilter !== 'all' ? 1 : 0) +
    (filters.selectionFilter !== 'all' ? 1 : 0)
  );
}

interface MailboxesModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  campaignId: string;
  accountId: string | null;
  currentMailboxIds: string[];
}

export function MailboxesModal({
  visible,
  onClose,
  onSaved,
  campaignId,
  accountId,
  currentMailboxIds,
}: MailboxesModalProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;
  const [accountMailboxes, setAccountMailboxes] = useState<MailboxOverview[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [campaignLoadFilter, setCampaignLoadFilter] = useState<CampaignLoadFilter>('all');
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>('all');
  const [showFiltersPopup, setShowFiltersPopup] = useState(false);
  const [filterTriggerLayout, setFilterTriggerLayout] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMailboxes, setIsLoadingMailboxes] = useState(false);
  const filterTriggerRef = useRef<View>(null);

  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return accountMailboxes.filter((mailbox) => {
      if (
        q &&
        !(mailbox.email_address || '').toLowerCase().includes(q) &&
        !(mailbox.display_name || '').toLowerCase().includes(q)
      ) {
        return false;
      }

      if (statusFilter !== 'all' && mailbox.status !== statusFilter) {
        return false;
      }

      if (campaignLoadFilter === '0' && mailbox.activeCampaignCount !== 0) {
        return false;
      }
      if (campaignLoadFilter === '1' && mailbox.activeCampaignCount !== 1) {
        return false;
      }
      if (campaignLoadFilter === '2+' && mailbox.activeCampaignCount < 2) {
        return false;
      }

      return true;
    });
  }, [accountMailboxes, campaignLoadFilter, search, statusFilter]);
  const filtered = useMemo(() => {
    if (selectionFilter === 'all') return baseFiltered;
    return baseFiltered.filter((mailbox) => {
      const isSelected = selectedIds.has(mailbox.id);
      if (selectionFilter === 'selected') return isSelected;
      return !isSelected;
    });
  }, [baseFiltered, selectedIds, selectionFilter]);
  const tableColumns = useMemo(
    () => buildMailboxOverviewColumns({ emailLabel: 'Email', todayLabel: 'Today' }),
    []
  );
  const activeFilterCount = countActiveMailboxFilters({
    statusFilter,
    campaignLoadFilter,
    selectionFilter,
  });

  const clearAllFilters = useCallback(() => {
    setStatusFilter('all');
    setCampaignLoadFilter('all');
    setSelectionFilter('all');
  }, []);

  useEffect(() => {
    if (!visible) {
      setShowFiltersPopup(false);
      setFilterTriggerLayout(null);
      return;
    }
    setSelectedIds(new Set(currentMailboxIds));
    setSearch('');
    setStatusFilter('all');
    setCampaignLoadFilter('all');
    setSelectionFilter('all');
    setShowFiltersPopup(false);
    setFilterTriggerLayout(null);

    if (accountId) {
      setIsLoadingMailboxes(true);
      getMailboxOverviewsByAccount(accountId)
        .then((all) => setAccountMailboxes(all || []))
        .catch(() => setAccountMailboxes([]))
        .finally(() => setIsLoadingMailboxes(false));
    } else {
      setAccountMailboxes([]);
    }
  }, [visible, accountId, currentMailboxIds]);

  useEffect(() => {
    if (!showFiltersPopup || isCompactLayout) {
      setFilterTriggerLayout(null);
      return;
    }
    const measure = () => {
      filterTriggerRef.current?.measureInWindow((x, y, w, h) => {
        setFilterTriggerLayout({ x, y, w, h });
      });
    };
    measure();
    const t = setTimeout(measure, 50);
    return () => clearTimeout(t);
  }, [showFiltersPopup, isCompactLayout]);

  useEffect(() => {
    if (!showFiltersPopup || isCompactLayout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFiltersPopup(false);
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
  }, [showFiltersPopup, isCompactLayout]);

  const toggleSelectedId = useCallback((mailboxId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mailboxId)) next.delete(mailboxId);
      else next.add(mailboxId);
      return next;
    });
  }, []);

  const handleMailboxRowPress = useCallback(
    (mailbox: MailboxOverview) => {
      toggleSelectedId(mailbox.id);
    },
    [toggleSelectedId]
  );

  const isDirty =
    selectedIds.size !== currentMailboxIds.length ||
    currentMailboxIds.some((id) => !selectedIds.has(id)) ||
    [...selectedIds].some((id) => !currentMailboxIds.includes(id));

  const handleClose = useConfirmClose(isDirty, onClose);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await assignMailboxesToCampaign(campaignId, Array.from(selectedIds));
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving mailboxes:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const filterFormScroll = (
    <ScrollView
      style={{ maxHeight: FILTER_PANEL_SCROLL_MAX }}
      contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-gray-400 font-instrument text-sm mb-4">
        Narrow the mailbox list without changing the selected assignments.
      </Text>

      <Select
        searchable={false}
        label="Connection status"
        items={STATUS_ITEMS}
        getItemId={(i) => i.id}
        getItemLabel={(i) => ({ primary: i.primary })}
        value={statusFilter}
        onChange={(id) => setStatusFilter(id as StatusFilter)}
        placeholder="All"
        listMaxHeight={200}
        size="compact"
        panelSize="compact"
      />

      <Select
        searchable={false}
        label="Active campaigns"
        items={CAMPAIGN_LOAD_ITEMS}
        getItemId={(i) => i.id}
        getItemLabel={(i) => ({ primary: i.primary })}
        value={campaignLoadFilter}
        onChange={(id) => setCampaignLoadFilter(id as CampaignLoadFilter)}
        placeholder="All"
        listMaxHeight={200}
        size="compact"
        panelSize="compact"
      />

      <Select
        searchable={false}
        label="Selection"
        items={SELECTION_ITEMS}
        getItemId={(i) => i.id}
        getItemLabel={(i) => ({ primary: i.primary })}
        value={selectionFilter}
        onChange={(id) => setSelectionFilter(id as SelectionFilter)}
        placeholder="All mailboxes"
        listMaxHeight={200}
        size="compact"
        panelSize="compact"
      />

      <View className="mt-2">
        <Button variant="secondary" size="sm" onPress={clearAllFilters} fullWidth>
          Clear filters
        </Button>
      </View>
    </ScrollView>
  );

  const filterPopup = isCompactLayout ? (
    <BottomSheet visible={showFiltersPopup} onClose={() => setShowFiltersPopup(false)}>
      <View style={{ maxHeight: Math.min(FILTER_PANEL_SCROLL_MAX + 80, screenHeight * 0.85) }}>
        <Text className="text-lg font-instrument-semibold text-white mb-1 px-4">Mailbox filters</Text>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {filterFormScroll}
        </KeyboardAvoidingView>
      </View>
    </BottomSheet>
  ) : showFiltersPopup ? (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => setShowFiltersPopup(false)}
    >
      <Pressable style={{ flex: 1 }} onPress={() => setShowFiltersPopup(false)}>
        {filterTriggerLayout &&
          (() => {
            const gap = 4;
            const edgeInset = 8;
            const panelW = Math.min(
              Math.max(filterTriggerLayout.w, FILTER_PANEL_MIN_WIDTH),
              screenWidth - edgeInset * 2
            );
            const panelApproxHeight = FILTER_PANEL_SCROLL_MAX;
            const spaceBelow = screenHeight - (filterTriggerLayout.y + filterTriggerLayout.h + gap);
            const spaceAbove = filterTriggerLayout.y;
            const openAbove =
              spaceBelow < panelApproxHeight && spaceAbove >= spaceBelow;
            const top = openAbove
              ? Math.max(edgeInset, filterTriggerLayout.y - panelApproxHeight - gap)
              : Math.min(
                  Math.max(edgeInset, filterTriggerLayout.y + filterTriggerLayout.h + gap),
                  screenHeight - panelApproxHeight - edgeInset
                );
            const left = Math.max(
              edgeInset,
              Math.min(filterTriggerLayout.x, screenWidth - panelW - edgeInset)
            );
            return (
              <Pressable
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: panelW,
                  maxHeight: FILTER_PANEL_SCROLL_MAX + 24,
                  backgroundColor: '#1A1A1A',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#2A2A2A',
                  ...(typeof window !== 'undefined'
                    ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
                    : {
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 8 },
                        shadowOpacity: 0.35,
                        shadowRadius: 16,
                        elevation: 12,
                      }),
                  overflow: 'hidden',
                }}
                onPress={(e) => e?.stopPropagation?.()}
              >
                <Text className="text-sm font-instrument-semibold text-white px-4 pt-4 pb-0">
                  Mailbox filters
                </Text>
                {filterFormScroll}
              </Pressable>
            );
          })()}
      </Pressable>
    </Modal>
  ) : null;

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Mailboxes"
      description={`Select which mailboxes send for this campaign. Selected: ${selectedIds.size}`}
      maxWidth="4xl"
      maxHeight={720}
      footer={
        <ModalFooter>
          <Button onPress={handleClose} variant="secondary">
            Cancel
          </Button>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="mb-3">
        <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
          <View
            className="flex-1 flex-row items-center rounded-xl bg-[#121212] border border-[#2A2A2A] px-3 py-2.5"
            style={{ borderWidth: 1, minWidth: 0 }}
          >
            <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by email or name..."
              placeholderTextColor="#6b7280"
              className="flex-1 text-white font-instrument text-sm py-0"
              style={{ minHeight: 24 }}
            />
          </View>
          <View ref={filterTriggerRef} collapsable={false}>
            <Pressable
              onPress={() => setShowFiltersPopup((o) => !o)}
              className="rounded-xl border items-center justify-center"
              style={{
                width: 44,
                height: 44,
                backgroundColor: '#121212',
                borderColor: '#2A2A2A',
                borderWidth: 1,
                flexShrink: 0,
              }}
            >
              <FunnelIcon
                size={18}
                color={activeFilterCount > 0 ? '#F3440D' : '#9CA3AF'}
              />
            </Pressable>
          </View>
        </View>
      </View>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gray-500 font-instrument text-xs">
          {isLoadingMailboxes
            ? 'Loading mailboxes…'
            : `Showing ${filtered.length} of ${accountMailboxes.length} mailboxes`}
        </Text>
        {!isLoadingMailboxes && activeFilterCount > 0 ? (
          <Text className="text-[#F3440D] font-instrument text-xs">
            {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
          </Text>
        ) : null}
      </View>

      {isLoadingMailboxes ? (
        <DataTable
          items={[]}
          columns={tableColumns}
          getItemKey={(mailbox) => mailbox.id}
          loading
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          pagination={false}
          widthMode="weighted-fill"
          compactHeader
        />
      ) : accountMailboxes.length === 0 ? (
        <Text className="text-gray-500 font-instrument text-sm">
          No mailboxes in this account. Add mailboxes in Senders first.
        </Text>
      ) : filtered.length === 0 ? (
        <Text className="text-gray-500 font-instrument text-sm">
          No mailboxes match the current filters.
        </Text>
      ) : (
        <DataTable
          items={filtered}
          columns={tableColumns}
          getItemKey={(mailbox) => mailbox.id}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          onRowPress={handleMailboxRowPress}
          pagination={false}
          widthMode="weighted-fill"
          compactHeader
        />
      )}
      {filterPopup}
    </BaseModal>
  );
}
