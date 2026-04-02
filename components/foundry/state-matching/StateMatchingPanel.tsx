import { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import {
  postImportScopedStateMatching,
  type PostStateMatchingBatchResponse,
} from '@/lib/foundry/registry-client';

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
  ingestionRunId: string;
};

export function StateMatchingPanel({ ingestionRunId }: Props) {
  const router = useRouter();
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchReused, setBatchReused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View className="mt-2">
      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">State registry matching</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
        Start one background job for all linked companies in this import. Automated registry matching supports Utah (UT)
        and Florida (FL) only, and companies that already have a promoted match or no target state are skipped
        automatically. Watch Runs for progress; if we are unsure about a match, check Queue.
      </Text>

      {error ? <Text className="text-red-400 mb-2 font-instrument text-sm">{error}</Text> : null}
      <Button
        variant="default"
        size="sm"
        disabled={busy}
        className="mb-3 self-start"
        onPress={async () => {
          setBusy(true);
          setError(null);
          setBatchSummary(null);
          setBatchJobId(null);
          setBatchReused(false);
          try {
            const r: PostStateMatchingBatchResponse = await postImportScopedStateMatching(ingestionRunId);
            setBatchSummary(summarizeStateMatchingBatchResponse(r));
            setBatchJobId(r.jobId);
            setBatchReused(Boolean(r.reused));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start state matching');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : 'Start state registry matching'}
      </Button>

      {batchSummary ? (
        <Text className="text-amber-200/90 font-instrument text-xs mb-2 leading-5">
          {batchReused ? 'A matching job is already running for this import. ' : ''}
          {batchSummary}
        </Text>
      ) : null}
      {batchJobId ? (
        <View className="mb-2">
          <Text className="text-emerald-300/90 font-instrument text-xs mb-1">
            {batchReused ? 'Using existing job' : 'Started job'} {batchJobId}
          </Text>
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
