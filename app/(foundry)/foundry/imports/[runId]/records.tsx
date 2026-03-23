import { useCallback, useState } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { ImportedRecordsTable } from '@/components/foundry/imports';
import {
  fetchIngestionRunRecords,
  postBulkResolution,
  postNormalizeIngestionRun,
  type IngestionRecordsFilter,
} from '@/lib/foundry/registry-client';
import type { ImportedRecordRow } from '@/lib/foundry/registry-types';

const FILTERS: { key: IngestionRecordsFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'missing_website', label: 'Missing website' },
  { key: 'warning_only', label: 'Warning rows' },
];

export default function ImportRecordsPage() {
  const router = useRouter();
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [filter, setFilter] = useState<IngestionRecordsFilter>('all');
  const [records, setRecords] = useState<ImportedRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!runId || typeof runId !== 'string') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIngestionRunRecords(runId, { limit: 500, offset: 0, filter });
      setRecords(res.records);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load records');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [runId, filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!runId || typeof runId !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid run.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="mb-4">
        <Breadcrumb
          items={[
            { label: 'Foundry', href: '/foundry' },
            { label: 'Imports', href: '/foundry/imports' },
            { label: 'Records' },
          ]}
        />
      </View>
      <PageHeader
        title="Imported records"
        subtitle="Normalize derived keys, open a row for detail, or bulk auto-resolve source→company."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}
      {actionMsg ? <Text className="text-emerald-400/90 mb-3 font-instrument text-sm">{actionMsg}</Text> : null}

      <View className="flex-row flex-wrap gap-2 mb-4">
        <Pressable
          disabled={busy}
          onPress={async () => {
            if (!runId) return;
            setBusy(true);
            setActionMsg(null);
            setError(null);
            try {
              const r = await postNormalizeIngestionRun(runId, { limit: 800 });
              setActionMsg(`Normalized ${r.updated} of ${r.scanned} rows (this page). Refresh list.`);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Normalize failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]"
        >
          <Text className="text-gray-200 font-instrument text-sm">Normalize keys (batch)</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setActionMsg(null);
            setError(null);
            try {
              const unresolved = records
                .filter((r) => r.link_status !== 'linked')
                .map((r) => r.id)
                .slice(0, 50);
              if (unresolved.length === 0) {
                setActionMsg('No unresolved rows in current list.');
                return;
              }
              const r = await postBulkResolution({ sourceBusinessRecordIds: unresolved, maxRecords: 50 });
              const summary = r.results.map((x) => x.outcome).join(', ');
              setActionMsg(`Bulk resolve (${unresolved.length}): ${summary}`);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Bulk resolve failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-brand-orange/50 bg-[rgba(243,68,13,0.08)]"
        >
          <Text className="text-white font-instrument text-sm">Auto-resolve unresolved (≤50)</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            className={`px-3 py-2 rounded-lg border ${
              filter === f.key ? 'border-brand-orange bg-[rgba(243,68,13,0.12)]' : 'border-[#3A3A3A] bg-[#1A1A1A]'
            }`}
          >
            <Text
              className={`font-instrument text-sm ${filter === f.key ? 'text-white' : 'text-gray-400'}`}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ImportedRecordsTable
        records={records}
        loading={loading}
        onRowPress={(r) => router.push(`/foundry/source-records/${r.id}`)}
      />
    </ScrollView>
  );
}
