import { View, Text, TextInput } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import type { ManualEntityOwnersFilters, PresenceFilter } from '@/components/foundry/dedupe/dedupeManualFilterTypes';

const PRESENCE_TABS: Tab[] = [
  { id: 'any', label: 'Any' },
  { id: 'present', label: 'Present' },
  { id: 'missing', label: 'Missing' },
];

const CURRENT_TABS: Tab[] = [
  { id: 'current', label: 'Current only' },
  { id: 'all', label: 'All rows' },
];

export function DedupeEntityOwnersFiltersModal({
  visible,
  filters,
  onChange,
  onClose,
  onClear,
}: {
  visible: boolean;
  filters: ManualEntityOwnersFilters;
  onChange: (filters: ManualEntityOwnersFilters) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Contact filters"
      description="These filters apply to the manual contacts table."
      maxWidth="lg"
      footer={
        <View className="flex-row flex-wrap gap-2 justify-end">
          <Button variant="secondary" onPress={onClear}>
            Clear filters
          </Button>
          <Button variant="default" onPress={onClose}>
            Done
          </Button>
        </View>
      }
    >
      <View className="mb-4">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Scope</Text>
        <Tabs
          tabs={CURRENT_TABS}
          activeTab={filters.currentOnly ? 'current' : 'all'}
          onTabChange={(id) => onChange({ ...filters, currentOnly: id === 'current' })}
          marginBottom={0}
        />
      </View>

      <View className="mb-4">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Owner normalized key</Text>
        <Tabs
          tabs={PRESENCE_TABS}
          activeTab={filters.ownerNormalizedKey}
          onTabChange={(id) => onChange({ ...filters, ownerNormalizedKey: id as PresenceFilter })}
          marginBottom={0}
        />
      </View>

      <View>
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">State entity id</Text>
        <TextInput
          value={filters.stateEntityId}
          onChangeText={(stateEntityId) => onChange({ ...filters, stateEntityId })}
          placeholder="Optional exact UUID"
          placeholderTextColor="#6b7280"
          className="border border-[#3A3A3A] rounded-lg px-3 py-2 text-white font-instrument text-sm bg-[#1A1A1A]"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </BaseModal>
  );
}
