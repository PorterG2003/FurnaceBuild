import { useCallback, useState } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import {
  fetchSourceRecordDetail,
  postGenerateSourceCandidates,
  postLinkSourceRecord,
  postRejectSourceCandidates,
} from '@/lib/foundry/registry-client';

export default function SourceRecordDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [json, setJson] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setError(null);
    try {
      const d = await fetchSourceRecordDetail(id);
      setJson(JSON.stringify(d, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setJson('');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!id || typeof id !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid record.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb
        items={[
          { label: 'Foundry', href: '/foundry' },
          { label: 'Imports', href: '/foundry/imports' },
          { label: 'Source record' },
        ]}
      />
      <PageHeader title="Source record" subtitle="Layer-1 resolution actions (registry API)" />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <View className="flex-row flex-wrap gap-2 mb-4">
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await postGenerateSourceCandidates(id);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]"
        >
          <Text className="text-gray-200 font-instrument text-sm">Generate candidates</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await postLinkSourceRecord(id, { createNew: true });
              if ((r as { company_id?: string }).company_id) {
                router.push(`/foundry/companies/${(r as { company_id: string }).company_id}`);
              }
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-brand-orange/50 bg-[rgba(243,68,13,0.08)]"
        >
          <Text className="text-white font-instrument text-sm">Create company + link</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await postRejectSourceCandidates(id);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]"
        >
          <Text className="text-gray-400 font-instrument text-sm">Reject candidates</Text>
        </Pressable>
      </View>

      <Text className="text-gray-500 font-instrument text-xs mb-2">API payload (debug)</Text>
      <Text className="text-gray-300 font-mono text-xs leading-5">{json || '…'}</Text>
    </ScrollView>
  );
}
