import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { ImportedRecordsTable } from '@/components/foundry/imports';
import { fetchIngestionRunRecords, type IngestionRecordsFilter } from '@/lib/foundry/registry-client';
import type { ImportedRecordRow } from '@/lib/foundry/registry-types';

const RECORD_FILTER_TABS: Tab[] = [
  { id: 'all', label: 'All' },
  { id: 'unresolved', label: 'Unresolved' },
  { id: 'missing_website', label: 'No website' },
  { id: 'warning_only', label: 'Warnings' },
];

export default function ImportRecordsPage() {
  const router = useRouter();
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const [filter, setFilter] = useState<IngestionRecordsFilter>('all');
  const [records, setRecords] = useState<ImportedRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        subtitle="Link rows to companies and fix data here. Normalize and auto-link run in the background after import—check Runs on the Foundry hub if something stalls."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Row filter</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-2 leading-5">
        Filter the table to focus on unresolved or problem rows, then return to Results for state registry matching when
        rows are linked.
      </Text>
      <Tabs
        tabs={RECORD_FILTER_TABS}
        activeTab={filter}
        onTabChange={(id) => setFilter(id as IngestionRecordsFilter)}
        marginBottom={12}
      />

      <ImportedRecordsTable
        records={records}
        loading={loading}
        onRowPress={(r) => router.push(`/foundry/source-records/${r.id}`)}
      />
    </ScrollView>
  );
}
