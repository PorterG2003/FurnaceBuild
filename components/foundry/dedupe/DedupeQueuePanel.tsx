import { View, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import { DedupeTaskCard } from '@/components/foundry/dedupe/DedupeTaskCard';
import { EntityOwnerDedupeTaskCard } from '@/components/foundry/dedupe/EntityOwnerDedupeTaskCard';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';

export function DedupeQueuePanel({
  table,
  tasks,
  loading,
  error,
  onRefresh,
  onTasksChanged,
}: {
  table: 'companies' | 'contacts';
  tasks: ReviewTaskRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onTasksChanged: () => void;
}) {
  return (
    <>
      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <View className="mb-4 gap-2">
        <Text className="text-gray-500 font-instrument text-sm leading-5">
          {table === 'companies'
            ? 'Each queue card is one duplicate company cluster from pending review tasks.'
            : 'Each queue card is one duplicate contact cluster from pending review tasks.'}
        </Text>
        <View className="flex-row flex-wrap gap-2 items-center">
          <Button variant="secondary" size="sm" onPress={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Text className="text-gray-500 font-instrument text-xs">
            {loading ? 'Loading…' : `${tasks.length} pending task${tasks.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {table === 'companies'
        ? tasks.map((task) => <DedupeTaskCard key={task.id} task={task} onTasksChanged={onTasksChanged} />)
        : tasks.map((task) => <EntityOwnerDedupeTaskCard key={task.id} task={task} onTasksChanged={onTasksChanged} />)}

      {!loading && tasks.length === 0 && !error ? (
        <Text className="text-gray-500 font-instrument text-sm leading-5">
          {table === 'companies'
            ? 'No pending company dedupe tasks. Tasks are created when two or more companies share the same normalized name key.'
            : 'No pending contact dedupe tasks. Tasks are created when two or more registry owners share the same normalized name key on the same state entity.'}
        </Text>
      ) : null}
    </>
  );
}
