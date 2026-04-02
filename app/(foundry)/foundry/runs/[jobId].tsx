import { useCallback, useState } from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { fetchFoundryJob } from '@/lib/foundry/registry-client';
import type { FoundryJobRow } from '@/lib/foundry/registry-types';
import { FoundryJobStatusBadge } from '@/components/foundry/runs/FoundryJobStatusBadge';
import {
  formatFoundryJobType,
  getIngestionRunIdFromJob,
  getSourceIngestionRunIdFromJob,
} from '@/components/foundry/runs/foundryJobDisplay';
import {
  FloridaPerCompanyBlock,
  RenderJobProgressSummary,
  UtahPerCompanyBlock,
} from '@/components/foundry/runs/renderJobProgress';

function PayloadSummary({ job }: { job: FoundryJobRow }) {
  const p = job.payload ?? {};
  const lines: string[] = [];
  if (typeof p.reconciliation_run_id === 'string') {
    lines.push(`Registry lookup run: ${p.reconciliation_run_id}`);
  }
  if (Array.isArray(p.company_ids)) {
    lines.push(`Company IDs: ${p.company_ids.length}`);
  }
  if (Array.isArray(p.utah_company_ids)) {
    lines.push(`Utah company IDs: ${p.utah_company_ids.length}`);
  }
  if (Array.isArray(p.florida_company_ids)) {
    lines.push(`Florida company IDs: ${p.florida_company_ids.length}`);
  }
  if (typeof p.batch_size === 'number') {
    lines.push(`Batch size: ${p.batch_size}`);
  }
  if (typeof p.freshness_window_days === 'number') {
    lines.push(`Freshness window: ${p.freshness_window_days} days`);
  }
  if (typeof p.force_rerun_recent === 'boolean') {
    lines.push(`Force rerun recent: ${p.force_rerun_recent ? 'yes' : 'no'}`);
  }
  if (typeof p.strong_targets_only === 'boolean') {
    lines.push(`Strong targets only: ${p.strong_targets_only ? 'yes' : 'no'}`);
  }
  if (typeof p.ruleset_preset === 'string') {
    lines.push(`Enrichment ruleset: ${p.ruleset_preset}`);
  }
  if (typeof p.queue_ambiguous_for_review === 'boolean') {
    lines.push(`Queue ambiguous for review: ${p.queue_ambiguous_for_review ? 'yes' : 'no'}`);
  }
  const ingest = getIngestionRunIdFromJob(job) ?? getSourceIngestionRunIdFromJob(job);
  if (ingest) lines.push(`Ingestion run: ${ingest}`);

  if (lines.length === 0) {
    return <Text className="text-gray-500 font-instrument text-xs">No summary fields on payload.</Text>;
  }
  return (
    <View className="gap-1">
      {lines.map((l) => (
        <Text key={l} className="text-gray-300 font-instrument text-xs">
          {l}
        </Text>
      ))}
    </View>
  );
}

export default function FoundryRunDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<FoundryJobRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId || typeof jobId !== 'string') return;
    setError(null);
    try {
      const res = await fetchFoundryJob(jobId);
      setJob(res.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load job');
      setJob(null);
    }
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!jobId || typeof jobId !== 'string') {
    return (
      <View className="flex-1 p-6">
        <Text className="text-gray-500">Invalid job.</Text>
      </View>
    );
  }

  const ingestId = job ? getIngestionRunIdFromJob(job) ?? getSourceIngestionRunIdFromJob(job) : null;
  const utahList = job?.progress?.utah_per_company;
  const floridaList = job?.progress?.florida_per_company;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb
        items={[
          { label: 'Foundry', href: '/foundry' },
          { label: 'Runs', href: '/foundry/runs' },
          { label: 'Detail' },
        ]}
      />
      <PageHeader title={job ? formatFoundryJobType(job.job_type) : 'Run detail'} subtitle={jobId} />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Text className="text-gray-400 font-instrument text-sm mb-3 leading-5">
        Use this page to see whether a background job succeeded. Red text under the job usually means you should fix
        data or retry from Results—not from here.
      </Text>

      <Button variant="secondary" size="sm" className="mb-4 self-start" onPress={() => void load()}>
        Refresh
      </Button>

      {job ? (
        <View className="gap-4" style={{ maxWidth: 960, alignSelf: 'center', width: '100%' }}>
          <View className="flex-row flex-wrap items-center gap-2">
            <FoundryJobStatusBadge status={job.status} />
            <Text className="text-gray-500 font-instrument text-xs">
              Updated {job.updated_at?.slice(0, 19) ?? '—'}
            </Text>
          </View>

          <View className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Timestamps</Text>
            <Text className="text-gray-300 font-instrument text-sm">Created: {job.created_at}</Text>
            <Text className="text-gray-300 font-instrument text-sm mt-1">Started: {job.started_at ?? '—'}</Text>
            <Text className="text-gray-300 font-instrument text-sm mt-1">Completed: {job.completed_at ?? '—'}</Text>
          </View>

          {job.step_function_execution_arn ? (
            <View className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
              <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">
                Execution reference (technical)
              </Text>
              <Text selectable className="text-gray-300 font-mono text-[10px] leading-4">
                {job.step_function_execution_arn}
              </Text>
            </View>
          ) : null}

          {job.error_summary ? (
            <View className="p-3 rounded-lg border border-red-500/30 bg-red-500/5">
              <Text className="text-red-300 font-instrument text-sm">{job.error_summary}</Text>
            </View>
          ) : null}

          {ingestId ? (
            <Button
              variant="link"
              size="sm"
              className="self-start px-0"
              onPress={() => router.push(`/foundry/imports/${ingestId}/results`)}
            >
              Open related import run
            </Button>
          ) : null}

          <View className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Progress</Text>
            <RenderJobProgressSummary progress={job.progress} />
            {Array.isArray(utahList) && utahList.length > 0 ? <UtahPerCompanyBlock items={utahList} /> : null}
            {Array.isArray(floridaList) && floridaList.length > 0 ? (
              <FloridaPerCompanyBlock items={floridaList} />
            ) : null}
          </View>

          <View className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Payload summary</Text>
            <PayloadSummary job={job} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
