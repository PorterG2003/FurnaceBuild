import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { StateMatchingPanel } from '@/components/foundry/state-matching/StateMatchingPanel';
import type { ImportPipeline } from '@/lib/foundry/registry-types';

type Props = {
  ingestionRunId: string;
  /** From the import response when this page is opened right after upload (same session). */
  importPipeline?: ImportPipeline | null;
};

export function ImportRunPipelineCard({ ingestionRunId, importPipeline }: Props) {
  const router = useRouter();
  const norm = importPipeline?.normalize;

  return (
    <Card variant="card">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-3">Pipeline</Text>
      <Text className="text-gray-400 font-instrument text-sm mb-4 leading-5">
        Your file is saved. After import we start normalize and auto-linking in the background. Use Queue when a human
        choice is required; use Runs to see background job status or errors.
      </Text>

      {norm?.status === 'failed' ? (
        <View className="mb-4 p-3 rounded-lg border border-red-900/60 bg-red-950/30">
          <Text className="text-red-300 font-instrument-semibold text-sm mb-1">Normalize did not start</Text>
          <Text className="text-red-200/90 font-instrument text-xs leading-5">{norm.error}</Text>
          {norm.detail ? (
            <Text className="text-red-300/80 font-mono text-[10px] mt-2 leading-4">{norm.detail}</Text>
          ) : null}
        </View>
      ) : null}

      {norm?.status === 'started' ? (
        <View className="mb-4 p-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20">
          <Text className="text-emerald-200/95 font-instrument text-sm">
            Normalize job {norm.reused ? 'already running' : 'started'}: {norm.jobId}
          </Text>
        </View>
      ) : null}

      <View className="gap-4">
        <View>
          <Text className="text-white font-instrument-semibold text-sm mb-1">1 · Records &amp; linking</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-2">
            Match each imported row to a company record. Do this before state lookup so we have businesses to attach to.
          </Text>
          <Button size="sm" variant="secondary" onPress={() => router.push(`/foundry/imports/${ingestionRunId}/records`)}>
            Open imported records
          </Button>
        </View>

        <View>
          <Text className="text-white font-instrument-semibold text-sm mb-1">2 · Normalize &amp; auto-link</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-2">
            Runs automatically after import. Rows get normalized keys; high-confidence matches link without you clicking
            anything. If something fails, check Runs (or the message above right after import).
          </Text>
          <Button variant="link" size="xs" className="self-start px-0" onPress={() => router.push('/foundry/runs')}>
            View Runs
          </Button>
        </View>

        <View>
          <Text className="text-white font-instrument-semibold text-sm mb-1">3 · State registries</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-2">
            Look up official business records by state. Utah runs as an automated lookup in the background; we compare
            names for you.
          </Text>
          <StateMatchingPanel ingestionRunId={ingestionRunId} />
        </View>

        <View>
          <Text className="text-white font-instrument-semibold text-sm mb-1">4 · Queue</Text>
          <Text className="text-gray-500 font-instrument text-xs mb-2">
            If we are not sure about a match or a link, a task lands here. Clear those before you consider the batch
            done.
          </Text>
          <Button variant="link" size="sm" className="self-start px-0" onPress={() => router.push('/foundry/queue')}>
            Open Queue
          </Button>
        </View>
      </View>
    </Card>
  );
}
