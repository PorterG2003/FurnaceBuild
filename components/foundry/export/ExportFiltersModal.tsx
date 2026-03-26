import { View, Text, TextInput, Pressable } from 'react-native';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { ExportReadyFilter, ExportTriFilter } from '@/components/foundry/export/exportFilterTypes';

const READY_TABS: Tab[] = [
  { id: 'ready', label: 'Export-ready' },
  { id: 'all', label: 'All rows' },
  { id: 'blocked', label: 'Not ready' },
];

function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ExportTriFilter;
  onChange: (v: ExportTriFilter) => void;
}) {
  const cycle = () => {
    onChange(value === 'any' ? 'yes' : value === 'yes' ? 'no' : 'any');
  };
  const hint = value === 'any' ? 'Any' : value === 'yes' ? 'Yes' : 'No';
  return (
    <Pressable
      onPress={cycle}
      className="py-2 px-3 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A] mb-2 mr-2"
    >
      <Text className="text-gray-500 font-instrument text-xs">{label}</Text>
      <Text className="text-white font-instrument text-sm">{hint}</Text>
    </Pressable>
  );
}

export function ExportFiltersModal({
  visible,
  onClose,
  registryState,
  onRegistryStateChange,
  exportReady,
  onExportReadyChange,
  linkedFilter,
  onLinkedFilterChange,
  reviewFilter,
  onReviewFilterChange,
  parseFilter,
  onParseFilterChange,
  ownerFilter,
  onOwnerFilterChange,
  onClearFilters,
}: {
  visible: boolean;
  onClose: () => void;
  registryState: string;
  onRegistryStateChange: (t: string) => void;
  exportReady: ExportReadyFilter;
  onExportReadyChange: (v: ExportReadyFilter) => void;
  linkedFilter: ExportTriFilter;
  onLinkedFilterChange: (v: ExportTriFilter) => void;
  reviewFilter: ExportTriFilter;
  onReviewFilterChange: (v: ExportTriFilter) => void;
  parseFilter: ExportTriFilter;
  onParseFilterChange: (v: ExportTriFilter) => void;
  ownerFilter: ExportTriFilter;
  onOwnerFilterChange: (v: ExportTriFilter) => void;
  onClearFilters: () => void;
}) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Export filters"
      description="Changes apply immediately. Extra filters: tap to cycle Any → Yes → No."
      maxWidth="lg"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button variant="secondary" onPress={onClearFilters}>
            Clear filters
          </Button>
          <Button variant="default" onPress={onClose}>
            Done
          </Button>
        </View>
      }
    >
      <View className="gap-1">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Registry state</Text>
        <TextInput
          value={registryState}
          onChangeText={(t) => onRegistryStateChange(t.toUpperCase())}
          placeholder="e.g. UT"
          placeholderTextColor="#6b7280"
          maxLength={8}
          className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#1A1A1A] mb-4"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Readiness</Text>
        <Tabs
          tabs={READY_TABS}
          activeTab={exportReady}
          onTabChange={(id) => onExportReadyChange(id as ExportReadyFilter)}
          marginBottom={16}
        />

        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Extra filters</Text>
        <View className="flex-row flex-wrap">
          <TriToggle label="Linked source" value={linkedFilter} onChange={onLinkedFilterChange} />
          <TriToggle label="Has owner row" value={ownerFilter} onChange={onOwnerFilterChange} />
          <TriToggle label="Open review" value={reviewFilter} onChange={onReviewFilterChange} />
          <TriToggle label="Parse failure task" value={parseFilter} onChange={onParseFilterChange} />
        </View>
      </View>
    </BaseModal>
  );
}
