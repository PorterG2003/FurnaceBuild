import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PageHeader, Breadcrumb } from '@/components/ui/layout';
import { Tabs, type Tab } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { fetchFoundryJobs } from '@/lib/foundry/registry-client';
import type { FoundryJobRow } from '@/lib/foundry/registry-types';
import { FoundryJobStatusBadge } from '@/components/foundry/runs/FoundryJobStatusBadge';
import {
  formatFoundryJobType,
  getCsvBuilderExportDownloadUrl,
  getIngestionRunIdFromJob,
  getSourceIngestionRunIdFromJob,
  openCsvBuilderExportDownload,
} from '@/components/foundry/runs/foundryJobDisplay';

type StatusFilter = 'all' | 'queued' | 'running' | 'completed' | 'failed';

const STATUS_TABS: Tab[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'queued', label: 'Queued' },
  { id: 'completed', label: 'Done' },
  { id: 'failed', label: 'Failed' },
];

export default function FoundryRunsListScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<FoundryJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchFoundryJobs({
        limit: 50,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setJobs(res.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
      setJobs([]);
    }
  }, [statusFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sorted = useMemo(() => jobs, [jobs]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <Breadcrumb items={[{ label: 'Foundry', href: '/foundry' }, { label: 'Runs' }]} />
      <PageHeader
        title="Runs"
        subtitle="Background jobs for this workspace, including normalize, state matching, and contact enrichment. Approval work still lives in Queue."
      />

      {error ? <Text className="text-red-400 mb-3 font-instrument text-sm">{error}</Text> : null}

      <Text className="text-gray-400 font-instrument text-sm mb-3 leading-5">
        Open a row to see errors and progress. If something failed, fix the underlying data or retry from the import’s
        Results page.
      </Text>

      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">Job status</Text>
      <Tabs
        tabs={STATUS_TABS}
        activeTab={statusFilter}
        onTabChange={(id) => setStatusFilter(id as StatusFilter)}
        marginBottom={8}
      />
      <Button variant="secondary" size="sm" className="self-start mb-4" onPress={() => void load()}>
        Refresh list
      </Button>

      <View className="gap-3" style={{ maxWidth: 960, alignSelf: 'center', width: '100%' }}>
        {sorted.map((job) => {
          const ingestId = getIngestionRunIdFromJob(job);
          const sourceIngest = getSourceIngestionRunIdFromJob(job);
          const runLinkId = ingestId ?? sourceIngest;
          const csvExportUrl = getCsvBuilderExportDownloadUrl(job);
          return (
            <View key={job.id} className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
              <Pressable
                onPress={() => router.push(`/foundry/runs/${job.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open job ${formatFoundryJobType(job.job_type)}`}
              >
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="text-white font-instrument-semibold text-sm flex-1 min-w-[140px]">
                    {formatFoundryJobType(job.job_type)}
                  </Text>
                  <FoundryJobStatusBadge status={job.status} />
                </View>
                <Text className="text-gray-500 font-mono text-[10px] mt-2">{job.id}</Text>
                <Text className="text-gray-500 font-instrument text-xs mt-1">
                  {job.started_at ? `Started ${job.started_at.slice(0, 19)}` : 'Not started'}
                  {job.completed_at ? ` · Completed ${job.completed_at.slice(0, 19)}` : ''}
                </Text>
                {job.error_summary ? (
                  <Text className="text-red-400/90 font-instrument text-xs mt-1" numberOfLines={2}>
                    {job.error_summary}
                  </Text>
                ) : null}
              </Pressable>
              {csvExportUrl ? (
                <View className="mt-2">
                  <Button
                    variant="link"
                    size="xs"
                    className="self-start px-0"
                    onPress={() => openCsvBuilderExportDownload(csvExportUrl)}
                  >
                    Download CSV
                  </Button>
                  <Text className="text-gray-600 font-instrument text-[10px] mt-1 leading-4">
                    Link expires after ~15 minutes; start a new export from CSV Builder if it fails.
                  </Text>
                </View>
              ) : null}
              {runLinkId ? (
                <Button
                  variant="link"
                  size="xs"
                  className="self-start px-0 mt-2"
                  onPress={() => router.push(`/foundry/imports/${runLinkId}/results`)}
                >
                  Open import run
                </Button>
              ) : null}
            </View>
          );
        })}
      </View>

      {sorted.length === 0 && !error ? (
        <Text className="text-gray-500 font-instrument text-sm mt-4 leading-5">
          No jobs match this tab. Try another status, or start normalize or state lookup from an import’s Results page.
        </Text>
      ) : null}
    </ScrollView>
  );
}
