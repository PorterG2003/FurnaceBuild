import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PageHeader } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/Card';
import {
  fetchFoundryJobs,
  fetchIngestionRuns,
  fetchReviewTasks,
} from '@/lib/foundry/registry-client';
import type { FoundryJobRow } from '@/lib/foundry/registry-types';
import { FoundryJobStatusBadge } from '@/components/foundry/runs/FoundryJobStatusBadge';
import { formatFoundryJobType } from '@/components/foundry/runs/foundryJobDisplay';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="card" className="flex-1 min-w-[140px]">
      <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-1">{label}</Text>
      <Text className="text-white font-instrument-semibold text-2xl">{value}</Text>
      {hint ? <Text className="text-gray-500 font-instrument text-[10px] mt-1 leading-4">{hint}</Text> : null}
    </Card>
  );
}

const PLAYBOOK_STEPS = [
  '1. Import a CSV — Creates this batch of rows; normalize and auto-link start in the background (see Runs if that step fails).',
  '2. Open this import’s Results — Home base for state lookup and links to Queue and Runs.',
  '3. Open Imported records and link each row to a company — Unlinked rows are skipped when you run state lookup, because there is no company to match yet.',
  '4. Watch Runs — Background normalize and state jobs report success or failure there.',
  '5. Run state registry matching on Results — Utah (and other states) are looked up automatically; if a name match is unclear, a task appears in Queue.',
  '6. Open Queue and clear any tasks — Promote, reject, or link so nothing important is left undecided; then use Export when you are ready to ship data out.',
] as const;

const MORE_DETAIL_BULLETS = [
  '“Runs” is for automatic jobs (normalize and state lookup). Errors show there first.',
  '“Queue” is only when the system is not sure—your choices finish the work.',
  'If you click “Start” twice on the same batch while it is already running, we keep the same job instead of duplicating it.',
] as const;

export function FoundryDashboard() {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [runningJobs, setRunningJobs] = useState<number | null>(null);
  const [lastImportLabel, setLastImportLabel] = useState<string | null>(null);
  const [lastImportRunId, setLastImportRunId] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<FoundryJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moreDetailOpen, setMoreDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tasksRes, jobsRunningRes, runsRes, jobsRecentRes] = await Promise.all([
        fetchReviewTasks({ status: 'pending', limit: 100 }),
        fetchFoundryJobs({ status: 'running', limit: 50 }),
        fetchIngestionRuns({ limit: 1 }),
        fetchFoundryJobs({ limit: 5 }),
      ]);
      const n = tasksRes.tasks.length;
      setPendingCount(n);
      setRunningJobs(jobsRunningRes.jobs.length);
      const r0 = runsRes.runs[0];
      if (r0) {
        setLastImportRunId(r0.id);
        const name =
          typeof r0.config?.import_name === 'string' && r0.config.import_name.trim()
            ? r0.config.import_name.trim()
            : r0.id.slice(0, 8);
        setLastImportLabel(`${name} · ${(r0.started_at ?? '').slice(0, 10)}`);
      } else {
        setLastImportRunId(null);
        setLastImportLabel(null);
      }
      setRecentJobs(jobsRecentRes.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      setPendingCount(null);
      setRunningJobs(null);
      setLastImportLabel(null);
      setLastImportRunId(null);
      setRecentJobs([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const pendingDisplay =
    pendingCount == null ? '—' : pendingCount >= 100 ? '100+' : String(pendingCount);

  const queueHint =
    'These need a person to decide. Zero can mean you are caught up—or that jobs are still running.' +
    (pendingCount != null && pendingCount >= 100 ? '\n(List shows up to 100 tasks.)' : '');

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
    >
      <PageHeader
        title="Dashboard"
        subtitle="Work one import run at a time: link rows to companies, then let background jobs clean data and look up state records—because later steps only work once companies exist and jobs have finished."
      />

      {error ? <Text className="text-red-400 mb-4 font-instrument text-sm">{error}</Text> : null}

      <View className="flex-row flex-wrap gap-3 mb-6">
        <StatCard label="Queue (pending)" value={pendingDisplay} hint={queueHint} />
        <StatCard
          label="Runs (active)"
          value={runningJobs == null ? '—' : String(runningJobs)}
          hint="A number above zero means a background job is still working or waiting; open Runs to see which one."
        />
        <Card variant="card" className="flex-1 min-w-[160px]">
          <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Latest import</Text>
          {lastImportLabel && lastImportRunId ? (
            <>
              <Button
                variant="link"
                size="sm"
                className="self-start px-0 items-start"
                onPress={() => router.push(`/foundry/imports/${lastImportRunId}/results`)}
              >
                {lastImportLabel}
              </Button>
              <Text className="text-gray-500 font-instrument text-[10px] mt-1 leading-4">
                Open this to continue where you left off on the same batch.
              </Text>
            </>
          ) : (
            <Text className="text-gray-500 font-instrument text-sm">None yet</Text>
          )}
        </Card>
      </View>

      <Card variant="card" className="mb-8">
        <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider mb-2">
          TYPICAL WORKFLOW
        </Text>
        <Text className="text-gray-400 font-instrument text-sm mb-3 leading-5">
          Follow this order so you are not stuck wondering which screen to open next.
        </Text>
        <View className="gap-3">
          {PLAYBOOK_STEPS.map((line) => (
            <Text key={line} className="text-gray-300 font-instrument text-sm leading-5">
              {line}
            </Text>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2 mt-4">
          <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/imports/new')}>
            New import
          </Button>
          <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/imports')}>
            All imports
          </Button>
          {lastImportRunId ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => router.push(`/foundry/imports/${lastImportRunId}/results`)}
              >
                Latest Results
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => router.push(`/foundry/imports/${lastImportRunId}/records`)}
              >
                Latest records
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/runs')}>
            Runs
          </Button>
          <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/queue')}>
            Queue
          </Button>
          <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/export')}>
            Export
          </Button>
        </View>
        <View className="mt-4">
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            onPress={() => setMoreDetailOpen((o) => !o)}
          >
            {moreDetailOpen ? '▼' : '▶'} More detail
          </Button>
          {moreDetailOpen ? (
            <View className="mt-2 gap-1 pl-1">
              {MORE_DETAIL_BULLETS.map((b) => (
                <Text key={b} className="text-gray-500 font-instrument text-xs leading-5">
                  - {b}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </Card>

      <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider mb-2">Shortcuts</Text>
      <View className="flex-row flex-wrap gap-2 mb-8">
        <Button size="sm" onPress={() => router.push('/foundry/imports/new')}>
          New import
        </Button>
        <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/queue')}>
          Open queue
        </Button>
        <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/runs')}>
          Open runs
        </Button>
        <Button size="sm" variant="secondary" onPress={() => router.push('/foundry/imports')}>
          All imports
        </Button>
      </View>

      <View className="flex-row flex-wrap items-center justify-between gap-2 mb-2">
        <Text className="text-gray-500 font-instrument-semibold text-xs uppercase tracking-wider">Recent jobs</Text>
        <Button variant="secondary" size="xs" onPress={() => void load()}>
          Refresh
        </Button>
      </View>

      <View className="gap-2" style={{ maxWidth: 960, alignSelf: 'stretch' }}>
        {recentJobs.map((job) => (
          <Pressable
            key={job.id}
            onPress={() => router.push(`/foundry/runs/${job.id}`)}
            className="p-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] flex-row flex-wrap items-center gap-2"
          >
            <View className="flex-1 min-w-[160px]">
              <Text className="text-white font-instrument text-sm">{formatFoundryJobType(job.job_type)}</Text>
              <Text className="text-gray-500 font-mono text-[10px] mt-0.5">{job.id}</Text>
            </View>
            <FoundryJobStatusBadge status={job.status} />
            <Text className="text-gray-500 font-instrument text-[10px] w-full">
              {job.updated_at?.slice(0, 19) ?? ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {recentJobs.length === 0 && !error ? (
        <Text className="text-gray-500 font-instrument text-sm mt-2">No jobs yet.</Text>
      ) : null}

      <Button variant="secondary" size="sm" className="mt-8 self-start" onPress={() => router.push('/foundry/export')}>
        Export
      </Button>
    </ScrollView>
  );
}
