import { useCallback, useState } from 'react';
import { View, ScrollView, Text, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { ImportRunTable } from '@/components/foundry/imports';
import { fetchIngestionRuns } from '@/lib/foundry/registry-client';
import type { IngestionRunRow } from '@/lib/foundry/registry-types';

export default function ImportsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchIngestionRuns({ limit: 80 });
      setRuns(res.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports');
      setRuns([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor="#f3440d" />}
    >
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Imports' }]} />
      </View>
      <View className="flex-row flex-wrap items-start justify-between gap-3 mb-2">
        <PageHeader
          title="Imports"
          subtitle="Each row is one import. Open Results for state lookup and the rest of the pipeline; normalize starts automatically after upload."
        />
        <Button onPress={() => router.push('/foundry/imports/new')}>New Import</Button>
      </View>

      {error ? (
        <Text className="text-red-400 font-instrument text-sm mb-4">{error}</Text>
      ) : null}

      <ImportRunTable runs={runs} loading={loading} />
    </ScrollView>
  );
}
