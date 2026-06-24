import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BaseModal, BottomSheet, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/forms';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import { isSmartleadCampaign } from '@/lib/campaigns/utils';
import {
  getCampaignsListSummary,
  type CampaignListSummary,
} from '@/lib/supabase/services/campaigns/campaign-list-summary';
import { buildCampaignPickerColumns } from './campaignPickerColumns';

type StatusFilter = 'all' | CampaignListSummary['status'];
type SelectionFilter = 'all' | 'selected' | 'unselected';

const STATUS_ITEMS: { id: StatusFilter; primary: string }[] = [
  { id: 'all', primary: 'All' },
  { id: 'running', primary: 'Running' },
  { id: 'paused', primary: 'Paused' },
  { id: 'stopped', primary: 'Stopped' },
  { id: 'draft', primary: 'Draft' },
];

const SELECTION_ITEMS: { id: SelectionFilter; primary: string }[] = [
  { id: 'all', primary: 'All campaigns' },
  { id: 'selected', primary: 'Selected only' },
  { id: 'unselected', primary: 'Unselected only' },
];

const FILTER_PANEL_SCROLL_MAX = 360;
const FILTER_PANEL_MIN_WIDTH = 300;

function countActiveCampaignFilters(filters: {
  statusFilter: StatusFilter;
  selectionFilter: SelectionFilter;
}) {
  return (
    (filters.statusFilter !== 'all' ? 1 : 0) + (filters.selectionFilter !== 'all' ? 1 : 0)
  );
}

export interface CampaignPickerModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string | null;
  selectedCampaignIds: string[];
  onSelectionChange: (ids: string[]) => void;
  overlayZIndex?: number;
}

export function CampaignPickerModal({
  visible,
  onClose,
  accountId,
  selectedCampaignIds,
  onSelectionChange,
  overlayZIndex,
}: CampaignPickerModalProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isCompactLayout = screenWidth < LAYOUT_BREAKPOINT;

  const [campaigns, setCampaigns] = useState<CampaignListSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>('all');
  const [showFiltersPopup, setShowFiltersPopup] = useState(false);
  const [filterTriggerLayout, setFilterTriggerLayout] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const filterTriggerRef = useRef<View>(null);

  const nativeCampaigns = useMemo(
    () => campaigns.filter((campaign) => !isSmartleadCampaign(campaign)),
    [campaigns],
  );

  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nativeCampaigns.filter((campaign) => {
      if (q && !campaign.name.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && campaign.status !== statusFilter) return false;
      return true;
    });
  }, [nativeCampaigns, search, statusFilter]);

  const filtered = useMemo(() => {
    if (selectionFilter === 'all') return baseFiltered;
    return baseFiltered.filter((campaign) => {
      const isSelected = selectedIds.has(campaign.id);
      if (selectionFilter === 'selected') return isSelected;
      return !isSelected;
    });
  }, [baseFiltered, selectedIds, selectionFilter]);

  const tableColumns = useMemo(() => buildCampaignPickerColumns(), []);

  const activeFilterCount = countActiveCampaignFilters({ statusFilter, selectionFilter });

  const clearAllFilters = useCallback(() => {
    setStatusFilter('all');
    setSelectionFilter('all');
  }, []);

  useEffect(() => {
    if (!visible) {
      setShowFiltersPopup(false);
      setFilterTriggerLayout(null);
      return;
    }

    setSelectedIds(new Set(selectedCampaignIds));
    setSearch('');
    setStatusFilter('all');
    setSelectionFilter('all');

    if (accountId) {
      setIsLoading(true);
      getCampaignsListSummary(accountId)
        .then((rows) => setCampaigns(rows))
        .catch(() => setCampaigns([]))
        .finally(() => setIsLoading(false));
    } else {
      setCampaigns([]);
    }
  }, [visible, accountId, selectedCampaignIds]);

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

  const toggleSelectedId = useCallback((campaignId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }, []);

  const handleRowPress = useCallback(
    (campaign: CampaignListSummary) => {
      toggleSelectedId(campaign.id);
    },
    [toggleSelectedId],
  );

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);

  const isDirty =
    selectedIdList.length !== selectedCampaignIds.length ||
    selectedCampaignIds.some((id) => !selectedIds.has(id)) ||
    selectedIdList.some((id) => !selectedCampaignIds.includes(id));

  const handleClose = useConfirmClose(isDirty, onClose);

  const handleDone = () => {
    onSelectionChange(selectedIdList);
    onClose();
  };

  const filterFormScroll = (
    <ScrollView
      style={{ maxHeight: FILTER_PANEL_SCROLL_MAX }}
      contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-gray-400 font-instrument text-sm mb-4">
        Narrow the campaign list without changing your selections.
      </Text>
      <Select
        searchable={false}
        label="Status"
        items={STATUS_ITEMS}
        getItemId={(item) => item.id}
        getItemLabel={(item) => ({ primary: item.primary })}
        value={statusFilter}
        onChange={(id) => setStatusFilter((id as StatusFilter) ?? 'all')}
        variant="solid"
      />
      <View style={{ height: 12 }} />
      <Select
        searchable={false}
        label="Selection"
        items={SELECTION_ITEMS}
        getItemId={(item) => item.id}
        getItemLabel={(item) => ({ primary: item.primary })}
        value={selectionFilter}
        onChange={(id) => setSelectionFilter((id as SelectionFilter) ?? 'all')}
        variant="solid"
      />
      {activeFilterCount > 0 ? (
        <View style={{ marginTop: 16 }}>
          <Button variant="secondary" onPress={clearAllFilters}>
            Clear filters
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Select campaigns"
      description={`Selected: ${selectedIdList.length}`}
      maxWidth="4xl"
      maxHeight={720}
      overlayZIndex={overlayZIndex}
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={handleClose}>
            Cancel
          </Button>
          <Button onPress={handleDone}>Done</Button>
        </ModalFooter>
      }
    >
      <View style={{ gap: 12, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#FFFFFF4D',
              borderRadius: 12,
              paddingHorizontal: 12,
              backgroundColor: '#FFFFFF0D',
            }}
          >
            <MagnifyingGlassIcon size={18} color="#9CA3AF" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search campaigns…"
              placeholderTextColor="#666"
              style={{ flex: 1, color: '#FFF', paddingVertical: 10, paddingHorizontal: 8 }}
            />
          </View>
          <Pressable
            ref={filterTriggerRef}
            onPress={() => setShowFiltersPopup(true)}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: activeFilterCount > 0 ? '#F3440D' : '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
            }}
          >
            <FunnelIcon size={20} color={activeFilterCount > 0 ? '#F3440D' : '#9CA3AF'} />
          </Pressable>
        </View>

        <Text className="text-xs text-gray-400">
          Showing {filtered.length} of {nativeCampaigns.length} campaigns
          {activeFilterCount > 0 ? ` · ${activeFilterCount} filter(s) active` : ''}
        </Text>

        <DataTable
          items={filtered}
          columns={tableColumns}
          getItemKey={(row) => row.id}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
          onRowPress={handleRowPress}
          loading={isLoading}
          emptyMessage={search.trim() ? 'No campaigns match your search.' : 'No native campaigns found.'}
          pagination={false}
          widthMode="weighted-fill"
          compactHeader
        />
      </View>

      {showFiltersPopup && isCompactLayout ? (
        <BottomSheet visible onClose={() => setShowFiltersPopup(false)} title="Campaign filters">
          {filterFormScroll}
        </BottomSheet>
      ) : null}

      {showFiltersPopup && !isCompactLayout && filterTriggerLayout ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setShowFiltersPopup(false)}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowFiltersPopup(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <View
                style={{
                  position: 'absolute',
                  top: Math.min(
                    filterTriggerLayout.y + filterTriggerLayout.h + 8,
                    screenHeight - FILTER_PANEL_SCROLL_MAX - 24,
                  ),
                  left: Math.max(16, filterTriggerLayout.x + filterTriggerLayout.w - FILTER_PANEL_MIN_WIDTH),
                  width: FILTER_PANEL_MIN_WIDTH,
                  backgroundColor: '#1A1A1A',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#FFFFFF1A',
                  overflow: 'hidden',
                }}
              >
                {filterFormScroll}
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      ) : null}
    </BaseModal>
  );
}
