import { View, Text } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import type { ManualCompaniesFilters, PresenceFilter } from '@/components/foundry/dedupe/dedupeManualFilterTypes';

const PRESENCE_TABS: Tab[] = [
  { id: 'any', label: 'Any' },
  { id: 'present', label: 'Present' },
  { id: 'missing', label: 'Missing' },
];

function PresenceTabs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PresenceFilter;
  onChange: (value: PresenceFilter) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">{label}</Text>
      <Tabs tabs={PRESENCE_TABS} activeTab={value} onTabChange={(id) => onChange(id as PresenceFilter)} marginBottom={0} />
    </View>
  );
}

export function DedupeCompaniesFiltersModal({
  visible,
  filters,
  onChange,
  onClose,
  onClear,
}: {
  visible: boolean;
  filters: ManualCompaniesFilters;
  onChange: (filters: ManualCompaniesFilters) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Company filters"
      description="These filters apply to the manual companies table."
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
      <PresenceTabs
        label="Normalized key"
        value={filters.normalizedKey}
        onChange={(normalizedKey) => onChange({ ...filters, normalizedKey })}
      />
      <PresenceTabs label="Notes" value={filters.notes} onChange={(notes) => onChange({ ...filters, notes })} />
    </BaseModal>
  );
}
