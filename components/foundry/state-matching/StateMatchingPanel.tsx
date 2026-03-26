import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import {
  collectLinkedCompanyIdsFromIngestionRun,
  fetchRegistryCompanies,
  type PostStateMatchingBatchResponse,
  postStateMatchingBatch,
  postStateMatchingPreflight,
} from '@/lib/foundry/registry-client';

const BATCH_LIMIT = 50;

function summarizeStateMatchingBatchResponse(r: PostStateMatchingBatchResponse): string | null {
  const pre = r.preflight as
    | { ready?: string[]; already_matched?: string[]; missing_state?: string[] }
    | undefined
    | null;
  const ready = Array.isArray(pre?.ready) ? pre.ready : [];
  const already = Array.isArray(pre?.already_matched) ? pre.already_matched : [];
  const missing = Array.isArray(pre?.missing_state) ? pre.missing_state : [];

  if (ready.length === 0) {
    if (already.length > 0) {
      return (
        `None of your ${already.length} companies will run registry automation: each already has a promoted match for its target state (from company locations). ` +
        `To exercise Utah or Florida ECS, choose companies that are not yet promoted for that state—or adjust/reject the existing match in the registry first.`
      );
    }
    if (missing.length > 0) {
      return (
        `${missing.length} companies have no state on file (add a primary location with a state/region). No registry matching will run until that is fixed.`
      );
    }
    return 'No companies are in the preflight “ready” list (empty selection or nothing eligible).';
  }

  const bc = r.bucket_counts;
  if (!bc) return null;
  return (
    `Routed (ready companies only): Utah ECS ${bc.utah}, Florida ECS ${bc.florida}. ` +
    (bc.florida === 0 && bc.utah === 0
      ? 'No browser ECS tasks will run—finalize only.'
      : 'Watch ECS in the worker account for Utah then Florida when both have companies.')
  );
}

type Props = {
  /** When set, “Load from import” uses this run’s linked companies. */
  ingestionRunId?: string;
};

export function StateMatchingPanel({ ingestionRunId }: Props) {
  const router = useRouter();
  const [companyIdsText, setCompanyIdsText] = useState('');
  const [preflight, setPreflight] = useState('');
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [batchResult, setBatchResult] = useState('');
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadSummary, setLoadSummary] = useState<string | null>(null);

  const parseIds = useCallback((): string[] => {
    return companyIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [companyIdsText]);

  const idCount = useMemo(() => parseIds().length, [parseIds]);

  const loadFromImport = useCallback(async () => {
    if (!ingestionRunId) return;
    setBusy(true);
    setError(null);
    setLoadSummary(null);
    try {
      const r = await collectLinkedCompanyIdsFromIngestionRun(ingestionRunId);
      setCompanyIdsText(r.companyIds.join('\n'));
      setLoadSummary(
        `Scanned ${r.scannedRows} rows, ${r.linkedRows} linked → ${r.companyIds.length} unique companies; ${r.unlinkedRows} not linked.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load company IDs from import');
    } finally {
      setBusy(false);
    }
  }, [ingestionRunId]);

  return (
    <View className="mt-2">
      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">State registry matching</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
        Automated registry matching supports Utah (UT) and Florida (FL) only—companies in other states are rejected at
        start. Check the list first so you don’t start a long job when nothing is ready. “Start batch” runs ECS scrapers
        in the background (up to {BATCH_LIMIT} companies at a time). Watch Runs for progress; if we are unsure about a
        match, check Queue.
      </Text>

      {error ? <Text className="text-red-400 mb-2 font-instrument text-sm">{error}</Text> : null}

      {ingestionRunId ? (
        <Button
          variant="default"
          size="sm"
          disabled={busy}
          className="mb-2 self-start"
          onPress={() => void loadFromImport()}
        >
          Load linked company IDs from this import
        </Button>
      ) : null}

      {loadSummary ? (
        <Text className="text-emerald-400/90 font-instrument text-xs mb-3">{loadSummary}</Text>
      ) : null}

      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        className="mb-3 self-start"
        onPress={async () => {
          setBusy(true);
          setError(null);
          setLoadSummary(null);
          try {
            const { companies } = await fetchRegistryCompanies({ limit: 30 });
            setCompanyIdsText(companies.map((c) => c.id).join('\n'));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        Load sample company IDs (30)
      </Button>

      <Text className="text-gray-500 font-instrument text-xs mb-1">Company UUIDs (whitespace or comma separated)</Text>
      <TextInput
        multiline
        value={companyIdsText}
        onChangeText={setCompanyIdsText}
        placeholder="uuid per line"
        placeholderTextColor="#666"
        className="text-gray-200 font-mono text-xs p-3 rounded border border-[#3A3A3A] bg-[#121212] min-h-[100px] mb-2"
      />

      {idCount > BATCH_LIMIT ? (
        <Text className="text-amber-400/90 font-instrument text-xs mb-3">
          You have more than {BATCH_LIMIT} companies listed. Only the first {BATCH_LIMIT} are used per run—remove the
          first {BATCH_LIMIT} from the box after a batch finishes, then run the next group.
        </Text>
      ) : null}

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Actions</Text>
      <View className="flex-row flex-wrap gap-2 mb-3">
        <Button
          variant="secondary"
          size="sm"
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
              const text =
                capped
                  ? `Note: only the first ${BATCH_LIMIT} of ${ids.length} IDs were checked (batch limit).\n\n${JSON.stringify(r, null, 2)}`
                  : JSON.stringify(r, null, 2);
              setPreflight(text);
              setPreflightOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not run preflight check');
            } finally {
              setBusy(false);
            }
          }}
        >
          Run preflight
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            setBatchResult('');
            setBatchSummary(null);
            try {
              const ids = parseIds().slice(0, BATCH_LIMIT);
              const r: PostStateMatchingBatchResponse = await postStateMatchingBatch(ids, {
                sourceIngestionRunId: ingestionRunId,
              });
              setBatchResult(JSON.stringify(r, null, 2));
              setBatchSummary(summarizeStateMatchingBatchResponse(r));
              setBatchOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Batch failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Start batch (async)
        </Button>
      </View>

      {preflight ? (
        <View className="mb-3">
          <Button
            variant="link"
            size="xs"
            className="self-start px-0 mb-1"
            onPress={() => setPreflightOpen((o) => !o)}
          >
            {preflightOpen ? '▼' : '▶'} Technical: preflight details
          </Button>
          {preflightOpen ? (
            <Text className="text-gray-300 font-mono text-xs leading-5">{preflight}</Text>
          ) : null}
        </View>
      ) : null}
      {batchSummary ? (
        <Text className="text-amber-200/90 font-instrument text-xs mb-2 leading-5">{batchSummary}</Text>
      ) : null}
      {batchResult ? (
        <View className="mb-2">
          <Button
            variant="link"
            size="xs"
            className="self-start px-0 mb-1"
            onPress={() => setBatchOpen((o) => !o)}
          >
            {batchOpen ? '▼' : '▶'} Technical: batch response
          </Button>
          {batchOpen ? (
            <Text className="text-gray-300 font-mono text-xs leading-5 mb-2">{batchResult}</Text>
          ) : null}
          <Button
            variant="link"
            size="sm"
            className="self-start px-0 mt-1"
            onPress={() => router.push('/foundry/runs')}
          >
            Open Runs
          </Button>
        </View>
      ) : null}
    </View>
  );
}
