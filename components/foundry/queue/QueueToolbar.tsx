import { View, Text } from 'react-native';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

export type QueueTaskFilter = 'all' | 'source_link_review' | 'entity_match_review' | 'other';

const TASK_TABS: Tab[] = [
  { id: 'all', label: 'All' },
  { id: 'source_link_review', label: 'Source link' },
  { id: 'entity_match_review', label: 'Entity match' },
  { id: 'other', label: 'Other' },
];

const SCOPE_TABS: Tab[] = [
  { id: 'pending', label: 'Pending only' },
  { id: 'all_statuses', label: 'All statuses' },
];

export function QueueToolbar({
  filter,
  onFilterChange,
  onRefresh,
  pendingOnly,
  onPendingOnlyChange,
}: {
  filter: QueueTaskFilter;
  onFilterChange: (f: QueueTaskFilter) => void;
  onRefresh: () => void;
  pendingOnly: boolean;
  onPendingOnlyChange: (v: boolean) => void;
}) {
  return (
    <View className="mb-4 gap-2">
      <Text className="text-gray-500 font-instrument text-sm mb-3 leading-5">
        Use the tabs to narrow the list. “Pending only” hides tasks you already finished.
      </Text>
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Task type</Text>
      <Tabs
        tabs={TASK_TABS}
        activeTab={filter}
        onTabChange={(id) => onFilterChange(id as QueueTaskFilter)}
        marginBottom={8}
      />
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1 mt-1">Task status</Text>
      <Tabs
        tabs={SCOPE_TABS}
        activeTab={pendingOnly ? 'pending' : 'all_statuses'}
        onTabChange={(id) => onPendingOnlyChange(id === 'pending')}
        marginBottom={12}
      />
      <Button variant="secondary" size="sm" className="self-start" onPress={onRefresh}>
        Refresh
      </Button>
    </View>
  );
}
