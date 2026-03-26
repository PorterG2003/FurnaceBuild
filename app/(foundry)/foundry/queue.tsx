import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { fetchReviewTasks } from '@/lib/foundry/registry-client';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';
import { QueueToolbar, type QueueTaskFilter } from '@/components/foundry/queue/QueueToolbar';
import { QueueTaskCard } from '@/components/foundry/queue/QueueTaskCard';

function matchesFilter(task: ReviewTaskRow, filter: QueueTaskFilter): boolean {
  /** Handled on the Dedupe screen — avoid two competing UIs. */
  if (task.task_type === 'company_dedupe' || task.task_type === 'entity_owner_dedupe') return false;
  if (filter === 'all') return true;
  if (filter === 'other') {
    return task.task_type !== 'source_link_review' && task.task_type !== 'entity_match_review';
  }
  return task.task_type === filter;
}

export default function FoundryQueueScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ReviewTaskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueTaskFilter>('all');
  const [pendingOnly, setPendingOnly] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchReviewTasks({
        status: pendingOnly ? 'pending' : undefined,
        limit: 100,
      });
      setTasks(r.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setTasks([]);
    }
  }, [pendingOnly]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(() => tasks.filter((t) => matchesFilter(t, filter)), [tasks, filter]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Queue' }]} />
      <PageHeader
        title="Queue"
        subtitle="These tasks appeared because the system needed a human: unclear registry match, or a source row that still needs a company. Pick one, decide, then refresh."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {msg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{msg}</Text> : null}

      <QueueToolbar
        filter={filter}
        onFilterChange={setFilter}
        onRefresh={() => void load()}
        pendingOnly={pendingOnly}
        onPendingOnlyChange={setPendingOnly}
      />

      {visible.map((t) => (
        <QueueTaskCard
          key={t.id}
          task={t}
          onResolved={(m) => {
            setMsg(m);
            setError(null);
            void load();
          }}
          onError={(m) => {
            setError(m || null);
            if (m) setMsg(null);
          }}
        />
      ))}

      {visible.length === 0 && !error ? (
        <View className="mt-2">
          <Text className="text-gray-500 font-instrument text-sm mb-2">No tasks match this filter.</Text>
          <Text className="text-gray-500 font-instrument text-sm mb-3 leading-5">
            Company and contact dedupe work lives on the Dedupe tab, not here. If you expected tasks after state lookup, open Runs
            and confirm the job finished. If the job succeeded and the queue is still empty, there was nothing that
            needed a human decision.
          </Text>
          <Button variant="default" size="sm" className="self-start" onPress={() => router.push('/foundry/imports')}>
            Go to Imports
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}
