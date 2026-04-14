import { useCallback, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { Breadcrumb, PageHeader } from '@/components/ui/layout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback/Alert';
import { useAccount } from '@/contexts/AccountContext';
import { fetchCsvBuilderRuns } from '@/lib/foundry/registry-client';
import type { CsvBuilderRunRow } from '@/lib/foundry/registry-types';
import { CsvBuilderEmptyState, CsvBuilderUploadCard } from '@/components/foundry/csv-builder';

export default function CsvBuilderLandingPage() {
  const { account } = useAccount();
  const [runs, setRuns] = useState<CsvBuilderRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCsvBuilderRuns({ account_id: account.id, limit: 10, offset: 0 });
      setRuns(result.runs);
    } catch (e) {
      setRuns([]);
      setError(e instanceof Error ? e.message : 'Failed to load CSV Builder runs');
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View className="mb-4">
        <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'CSV Builder' }]} />
      </View>
      <PageHeader
        title="CSV Builder"
        subtitle="Upload a one-off sheet, enrich it with tool-backed columns, and export the result asynchronously."
      />

      {!account?.id ? (
        <Alert variant="warning" message="No account is selected. Choose an account before starting a CSV Builder run." />
      ) : null}
      {error ? <Alert variant="error" message={error} /> : null}

      <View className="gap-4">
        <CsvBuilderEmptyState />
        <CsvBuilderUploadCard accountId={account?.id ?? ''} />

        <Card variant="card">
          <Text className="text-xs text-gray-500 uppercase tracking-wider mb-3">Recent runs</Text>
          {loading ? <Text className="text-gray-500 font-instrument text-sm">Loading…</Text> : null}
          {!loading && runs.length === 0 ? (
            <Text className="text-gray-500 font-instrument text-sm">No CSV Builder runs yet.</Text>
          ) : null}
          <View className="gap-3">
            {runs.map((run) => (
              <Card key={run.id} variant="card">
                <Text className="text-white font-instrument-medium text-sm">{run.name}</Text>
                <Text className="text-gray-400 font-instrument text-xs mt-1">
                  {run.source_row_count} rows · {run.visible_column_count} visible columns · {run.status}
                </Text>
                <Text className="text-gray-500 font-instrument text-xs mt-1">{run.source_file_name}</Text>
                <Link href={`/foundry/csv-builder/${run.id}`} asChild>
                  <Button variant="secondary" size="sm" className="self-start mt-3">
                    Open run
                  </Button>
                </Link>
              </Card>
            ))}
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
