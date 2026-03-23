import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import {
  ImportResultsSummary,
  ImportErrorsTable,
  useImportWizard,
} from '@/components/foundry/imports';
import { fetchIngestionRun } from '@/lib/foundry/registry-client';
import type { IngestionRunRow } from '@/lib/foundry/registry-types';

export default function ImportResultsPage() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const { lastImportResult, resetWizard } = useImportWizard();
  const [run, setRun] = useState<IngestionRunRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId || typeof runId !== 'string') return;
    setError(null);
    try {
      const res = await fetchIngestionRun(runId);
      setRun(res.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
      setRun(null);
    }
  }, [runId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const errorSamples =
    lastImportResult?.runId === runId ? lastImportResult.errorSamples : [];

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
            { label: 'Results' },
          ]}
        />
      </View>
      <PageHeader
        title="Import results"
        subtitle={
          typeof run?.config?.import_name === 'string' ? run.config.import_name : undefined
        }
      />

      {error ? <Text className="text-red-400 mb-4 font-instrument text-sm">{error}</Text> : null}

      {run ? (
        <View className="gap-4 w-full self-center" style={{ maxWidth: 960 }}>
          <ImportResultsSummary status={run.status} stats={run.stats} />

          <Card variant="card">
            <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Import metadata</Text>
            <Text className="text-gray-300 font-instrument text-sm">Run ID: {run.id}</Text>
            <Text className="text-gray-300 font-instrument text-sm mt-1">Source: {run.source_name}</Text>
            <Text className="text-gray-300 font-instrument text-sm mt-1">Started: {run.started_at}</Text>
            {run.completed_at ? (
              <Text className="text-gray-300 font-instrument text-sm mt-1">Completed: {run.completed_at}</Text>
            ) : null}
            {run.error_summary ? (
              <Text className="text-amber-400 font-instrument text-sm mt-2">{run.error_summary}</Text>
            ) : null}
          </Card>

          <Card variant="card">
            <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Validation summary (from run)</Text>
            <Text className="text-gray-400 font-instrument text-sm">
              Total {run.stats?.total_rows ?? '—'} · Valid {run.stats?.valid_rows ?? '—'} · Warnings{' '}
              {run.stats?.warning_rows ?? '—'} · Errors {run.stats?.error_rows ?? '—'}
            </Text>
          </Card>

          {errorSamples.length > 0 ? (
            <Card variant="card">
              <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Error sample (skipped rows)</Text>
              <ImportErrorsTable samples={errorSamples} />
            </Card>
          ) : null}

          <View className="flex-col sm:flex-row flex-wrap gap-2">
            <Button onPress={() => router.push(`/foundry/imports/${runId}/records`)}>View imported records</Button>
            <Button variant="secondary" onPress={() => router.push('/foundry/jobs')}>
              Go to resolution queue
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                resetWizard();
                router.push('/foundry/imports/new');
              }}
            >
              Start another import
            </Button>
          </View>
        </View>
      ) : !error ? (
        <Text className="text-gray-500 font-instrument">Loading…</Text>
      ) : null}
    </ScrollView>
  );
}
