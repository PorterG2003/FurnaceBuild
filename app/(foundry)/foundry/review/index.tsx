import { useCallback, useState } from 'react';
import { View, ScrollView, Text, Pressable, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { fetchReviewTasks, postReviewTaskResolve } from '@/lib/foundry/registry-client';
import type { ReviewTaskRow } from '@/lib/foundry/registry-types';

export default function FoundryReviewQueuePage() {
  const [tasks, setTasks] = useState<ReviewTaskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchReviewTasks({ status: 'pending', limit: 100 });
      setTasks(r.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setTasks([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Review queue' }]} />
      <PageHeader title="Review queue" subtitle="Pending review_tasks (resolve via API)" />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {msg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{msg}</Text> : null}

      <Pressable onPress={() => void load()} className="mb-4 px-3 py-2 rounded-lg border border-[#3A3A3A] self-start">
        <Text className="text-gray-200 font-instrument text-sm">Refresh</Text>
      </Pressable>

      {tasks.map((t) => (
        <View key={t.id} className="mb-4 p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
          <Text className="text-white font-instrument text-sm">{t.task_type}</Text>
          <Text className="text-gray-500 font-instrument text-xs mt-1">
            {t.entity_type} · {t.id}
          </Text>
          {t.task_type === 'source_link_review' ? (
            <View className="mt-2">
              <Text className="text-gray-400 font-instrument text-xs mb-1">Chosen company UUID</Text>
              <TextInput
                value={chosenId}
                onChangeText={setChosenId}
                placeholder="company id"
                placeholderTextColor="#666"
                className="text-gray-200 font-mono text-xs p-2 rounded border border-[#3A3A3A] bg-[#121212]"
              />
              <Pressable
                onPress={async () => {
                  setMsg(null);
                  try {
                    await postReviewTaskResolve(t.id, {
                      chosen_company_id: chosenId.trim(),
                      resolution: { via: 'foundry_ui' },
                    });
                    setMsg('Resolved task');
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Resolve failed');
                  }
                }}
                className="mt-2 px-3 py-2 rounded-lg bg-brand-orange"
              >
                <Text className="text-black font-instrument text-sm">Link to company</Text>
              </Pressable>
            </View>
          ) : null}
          {t.task_type === 'entity_match_review' ? (
            <View className="flex-row gap-2 mt-2">
              <Pressable
                onPress={async () => {
                  setMsg(null);
                  try {
                    await postReviewTaskResolve(t.id, {
                      chosen_match_action: 'promote',
                      resolution: { via: 'foundry_ui' },
                    });
                    setMsg('Promoted');
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed');
                  }
                }}
                className="px-3 py-2 rounded-lg border border-brand-orange"
              >
                <Text className="text-white font-instrument text-xs">Promote</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  setMsg(null);
                  try {
                    await postReviewTaskResolve(t.id, {
                      chosen_match_action: 'reject',
                      resolution: { via: 'foundry_ui' },
                    });
                    setMsg('Rejected');
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed');
                  }
                }}
                className="px-3 py-2 rounded-lg border border-[#3A3A3A]"
              >
                <Text className="text-gray-400 font-instrument text-xs">Reject match</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}

      {tasks.length === 0 ? <Text className="text-gray-500 font-instrument text-sm">No pending tasks.</Text> : null}
    </ScrollView>
  );
}
