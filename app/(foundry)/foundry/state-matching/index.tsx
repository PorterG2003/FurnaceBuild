import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Text, Pressable, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import {
  collectLinkedCompanyIdsFromIngestionRun,
  fetchIngestionRuns,
  fetchRegistryCompanies,
  postStateMatchingBatch,
  postStateMatchingPreflight,
} from '@/lib/foundry/registry-client';
import type { IngestionRunRow } from '@/lib/foundry/registry-types';

const BATCH_LIMIT = 50;

function importDisplayName(config: Record<string, unknown>): string {
  const n = config?.import_name;
  return typeof n === 'string' && n.trim() ? n.trim() : '—';
}

export default function StateMatchingPage() {
  const [companyIdsText, setCompanyIdsText] = useState('');
  const [preflight, setPreflight] = useState<string>('');
  const [batchResult, setBatchResult] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<IngestionRunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadSummary, setLoadSummary] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setError(null);
    try {
      const res = await fetchIngestionRuns({ limit: 80 });
      setRuns(res.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports');
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRuns();
    }, [loadRuns]),
  );

  function parseIds(): string[] {
    return companyIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const idCount = useMemo(() => parseIds().length, [companyIdsText]);

  return (
    <ScrollView
      className="flex-1"
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'State matching' }]} />
      <PageHeader
        title="State matching"
        subtitle="Preflight is synchronous. Batch starts Step Functions: mock connector for non-UT states, Utah browser scrape via ECS for UT."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">From import</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3">
        Choose the CSV import run, then tap the button below to fill company UUIDs from rows that are already linked to
        companies (normalize and resolve on Imports → records first).
      </Text>

      <View className="mb-3">
        <Select<IngestionRunRow>
          searchable={false}
          items={runs}
          getItemId={(r) => r.id}
          getItemLabel={(r) => ({
            primary: importDisplayName(r.config),
            secondary: `${(r.started_at ?? '').slice(0, 10)} · ${r.id.slice(0, 8)}…`,
          })}
          value={selectedRunId}
          onChange={(id) => {
            setSelectedRunId(id || null);
            setLoadSummary(null);
          }}
          loading={runsLoading}
          placeholder="Select import run…"
          label="Import run"
          emptyMessage={() => 'No imports yet. Create one under Foundry → Imports.'}
        />
      </View>

      {!selectedRunId && !runsLoading ? (
        <Text className="text-amber-400/90 font-instrument text-xs mb-2">
          Select an import in the dropdown first — then the orange button enables.
        </Text>
      ) : null}

      <Button
        variant="default"
        size="sm"
        disabled={busy || !selectedRunId}
        className="mb-3 self-start"
        onPress={async () => {
          if (!selectedRunId) return;
          setBusy(true);
          setError(null);
          setLoadSummary(null);
          try {
            const r = await collectLinkedCompanyIdsFromIngestionRun(selectedRunId);
            setCompanyIdsText(r.companyIds.join('\n'));
            setLoadSummary(
              `Scanned ${r.scannedRows} rows, ${r.linkedRows} linked → ${r.companyIds.length} unique companies; ${r.unlinkedRows} not linked.`,
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load company IDs from import');
          } finally {
            setBusy(false);
          }
        }}
      >
        Load linked company IDs from import
      </Button>

      {loadSummary ? (
        <Text className="text-emerald-400/90 font-instrument text-xs mb-3">{loadSummary}</Text>
      ) : null}

      <Pressable
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const { companies } = await fetchRegistryCompanies({ limit: 30 });
            setCompanyIdsText(companies.map((c) => c.id).join('\n'));
            setLoadSummary(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
        className="mb-3 px-3 py-2 rounded-lg border border-[#3A3A3A] self-start"
      >
        <Text className="text-gray-200 font-instrument text-sm">Load sample company IDs</Text>
      </Pressable>

      <Text className="text-gray-500 font-instrument text-xs mb-1">Company UUIDs (whitespace or comma separated)</Text>
      <TextInput
        multiline
        value={companyIdsText}
        onChangeText={setCompanyIdsText}
        placeholder="uuid per line"
        placeholderTextColor="#666"
        className="text-gray-200 font-mono text-xs p-3 rounded border border-[#3A3A3A] bg-[#121212] min-h-[120px] mb-2"
      />

      {idCount > BATCH_LIMIT ? (
        <Text className="text-amber-400/90 font-instrument text-xs mb-3">
          {idCount} IDs loaded. Each batch processes at most {BATCH_LIMIT} companies. Preflight uses the first{' '}
          {BATCH_LIMIT} only. After starting a batch, remove those lines from the box to run the next chunk.
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2 mb-4">
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            setPreflight('');
            try {
              const ids = parseIds();
              const capped = ids.length > BATCH_LIMIT;
              const toPreflight = capped ? ids.slice(0, BATCH_LIMIT) : ids;
              const r = await postStateMatchingPreflight(toPreflight);
              setPreflight(
                capped
                  ? `Note: preflight used first ${BATCH_LIMIT} of ${ids.length} IDs (batch limit).\n\n${JSON.stringify(r, null, 2)}`
                  : JSON.stringify(r, null, 2),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Preflight failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A]"
        >
          <Text className="text-gray-200 font-instrument text-sm">Preflight</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            setBatchResult('');
            try {
              const r = await postStateMatchingBatch(parseIds().slice(0, BATCH_LIMIT));
              setBatchResult(JSON.stringify(r, null, 2));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Batch failed');
            } finally {
              setBusy(false);
            }
          }}
          className="px-3 py-2 rounded-lg border border-brand-orange/50 bg-[rgba(243,68,13,0.08)]"
        >
          <Text className="text-white font-instrument text-sm">Start batch (async)</Text>
        </Pressable>
      </View>

      {preflight ? (
        <>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Preflight</Text>
          <Text className="text-gray-300 font-mono text-xs leading-5 mb-4">{preflight}</Text>
        </>
      ) : null}
      {batchResult ? (
        <>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Batch result</Text>
          <Text className="text-gray-300 font-mono text-xs leading-5">{batchResult}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}
