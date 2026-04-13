import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { MultiSegmentDial } from '@/components/ui/multi-segment-dial';
import { fetchIngestionRunPipelineJobs } from '@/lib/foundry/registry-client';
import type { FoundryJobProgress, FoundryJobRow, IngestionRunPipelineJobsResponse } from '@/lib/foundry/registry-types';

type Props = {
  ingestionRunId: string;
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp(value: number, total: number): number {
  return Math.max(0, Math.min(total, value));
}

function progressOf(job: FoundryJobRow | null | undefined): FoundryJobProgress {
  return (job?.progress ?? {}) as FoundryJobProgress;
}

function jobStatusLabel(job: FoundryJobRow | null): string {
  if (!job) return 'Not started';
  return job.status.replace('_', ' ');
}

function queueCountLabel(value: number | null): string {
  return typeof value === 'number' ? String(value) : '—';
}

type StateMatchingPayload = {
  company_ids?: unknown;
  preflight?: {
    already_matched?: unknown;
    missing_state?: unknown;
  };
};

function ContactEnrichmentDialCard({
  pipeline,
}: {
  pipeline: IngestionRunPipelineJobsResponse;
}) {
  const job = pipeline.contact_enrichment_job;
  if (!job) {
    return (
      <Card variant="card" className="flex-1 min-w-[220px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Contact enrichment</Text>
        <Text className="text-white font-instrument-semibold text-sm mb-2">Contact enrichment not started</Text>
        <Text className="text-gray-500 font-instrument text-xs leading-5">
          Run this manually after state matching when you want to buy contact data for resolved owner/person rows.
        </Text>
      </Card>
    );
  }

  const progress = progressOf(job);
  const total = Math.max(0, Math.floor(Number(progress.total_targets) || 0));
  const accepted = clamp(num(progress.outcome_accepted), total);
  const ambiguous = clamp(num(progress.outcome_ambiguous), total);
  const noMatch = clamp(num(progress.outcome_no_match), total);
  const error = clamp(num(progress.outcome_error), total);
  const skippedRecent = clamp(num(progress.outcome_skipped_recent), total);
  const processed = clamp(num(progress.targets_processed), total);
  const pending = Math.max(0, total - processed);

  return (
    <Card variant="card" className="flex-1 min-w-[220px]">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Contact enrichment</Text>
      <MultiSegmentDial
        total={Math.max(total, 1)}
        size={132}
        strokeWidth={10}
        centerValue={processed}
        centerTotal={Math.max(total, 1)}
        centerTopLabel="Processed"
        centerBottomLabel="Targets"
        segments={[
          { value: pending, color: '#6B7280' },
          { value: accepted, color: '#10B981' },
          { value: ambiguous, color: '#8B5CF6' },
          { value: noMatch, color: '#F59E0B' },
          { value: error, color: '#EF4444' },
          { value: skippedRecent, color: '#3B82F6' },
        ]}
        legend={{
          placement: 'bottom',
          rows: [
            { label: 'Pending', value: pending, color: '#6B7280' },
            { label: 'Accepted', value: accepted, color: '#10B981' },
            { label: 'Ambiguous', value: ambiguous, color: '#8B5CF6' },
            { label: 'No match', value: noMatch, color: '#F59E0B' },
            { label: 'Error', value: error, color: '#EF4444' },
            { label: 'Skipped recent', value: skippedRecent, color: '#3B82F6' },
          ],
        }}
      />
      <Text className="text-gray-500 font-instrument text-xs mt-2">Status: {jobStatusLabel(job)}</Text>
    </Card>
  );
}

function StateDialCard({
  pipeline,
}: {
  pipeline: IngestionRunPipelineJobsResponse;
}) {
  const job = pipeline.state_matching_job;
  if (!job) {
    return (
      <Card variant="card" className="flex-1 min-w-[220px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">State registries</Text>
        <Text className="text-white font-instrument-semibold text-sm mb-2">State matching not started</Text>
        <Text className="text-gray-500 font-instrument text-xs leading-5">
          Counts here reflect the state registry job for this import, not all historical registry results.
        </Text>
      </Card>
    );
  }

  const progress = progressOf(job);
  const payload = job.payload as StateMatchingPayload;
  const inScopeTotal = Math.max(0, Math.floor(Number(progress.in_scope_total) || 0));
  const excluded = Math.max(0, Math.floor(Number(progress.not_applicable_count) || 0));
  const linkedTotal =
    Array.isArray(payload.company_ids)
      ? payload.company_ids.length
      : Math.max(inScopeTotal + excluded, inScopeTotal);
  const outcomes =
    job.status === 'queued' || job.status === 'running'
      ? (pipeline.state_matching_outcome_counts ?? progress.reconciliation_outcomes ?? {})
      : (progress.reconciliation_outcomes ?? {});
  const matched = num(outcomes.matched);
  const noMatch = num(outcomes.no_match);
  const ambiguous = num(outcomes.ambiguous);
  const error = num(outcomes.error);
  const done = clamp(matched + noMatch + ambiguous + error, inScopeTotal);
  const pending = Math.max(0, inScopeTotal - done);
  const ringTotal = Math.max(linkedTotal, excluded + pending + done);
  const alreadyMatchedCount = Array.isArray(payload.preflight?.already_matched)
    ? payload.preflight.already_matched.length
    : null;
  const missingStateCount = Array.isArray(payload.preflight?.missing_state)
    ? payload.preflight.missing_state.length
    : null;
  const alreadyMatchedN = alreadyMatchedCount ?? 0;
  const missingStateN = missingStateCount ?? 0;
  const otherExcluded = Math.max(0, excluded - alreadyMatchedN - missingStateN);
  const accountedLinked = Math.max(0, ringTotal - pending);
  const primaryRows: { label: string; value: number; color: string }[] = [
    { label: 'Pending', value: pending, color: '#6B7280' },
    { label: 'Matched', value: matched, color: '#10B981' },
    { label: 'No match', value: noMatch, color: '#F59E0B' },
    { label: 'Ambiguous', value: ambiguous, color: '#8B5CF6' },
    { label: 'Error', value: error, color: '#EF4444' },
  ];
  if (alreadyMatchedCount && alreadyMatchedCount > 0) {
    primaryRows.push({ label: 'Already matched', value: alreadyMatchedCount, color: '#3B82F6' });
  }
  if (missingStateCount && missingStateCount > 0) {
    primaryRows.push({ label: 'Missing state', value: missingStateCount, color: '#6B7280' });
  }
  if (!alreadyMatchedCount && !missingStateCount) {
    primaryRows.push({ label: 'Excluded', value: excluded, color: '#6B7280' });
  } else if (otherExcluded > 0) {
    primaryRows.push({ label: 'Other excluded', value: otherExcluded, color: '#6B7280' });
  }

  return (
    <Card variant="card" className="flex-1 min-w-[220px]">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">State registries</Text>
      <MultiSegmentDial
        total={ringTotal}
        size={132}
        strokeWidth={10}
        centerValue={accountedLinked}
        centerTotal={ringTotal}
        centerTopLabel="Accounted"
        centerBottomLabel="Linked"
        segments={[
          { value: pending, color: '#6B7280' },
          { value: matched, color: '#10B981' },
          { value: noMatch, color: '#F59E0B' },
          { value: ambiguous, color: '#8B5CF6' },
          { value: error, color: '#EF4444' },
          { value: alreadyMatchedN, color: '#3B82F6' },
          { value: missingStateN, color: '#6B7280' },
          { value: otherExcluded, color: '#6B7280' },
        ]}
        legend={{
          placement: 'bottom',
          rows: primaryRows,
        }}
      />
      <Text className="text-gray-500 font-instrument text-xs mt-2">Status: {jobStatusLabel(job)}</Text>
    </Card>
  );
}

function WebsiteVerificationDialCard({
  pipeline,
}: {
  pipeline: IngestionRunPipelineJobsResponse;
}) {
  const job = pipeline.website_verification_job;
  if (!job) {
    return (
      <Card variant="card" className="flex-1 min-w-[220px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Website verify</Text>
        <Text className="text-white font-instrument-semibold text-sm mb-2">Website verification not started</Text>
        <Text className="text-gray-500 font-instrument text-xs leading-5">
          Run this manually to verify whether the on-file website appears to belong to each linked company.
        </Text>
      </Card>
    );
  }

  const progress = progressOf(job);
  const total = Math.max(0, Math.floor(Number(progress.in_scope_total) || 0));
  const usable =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_usable), total)
      : clamp(num(pipeline.website_verification_outcome_counts?.usable), total);
  const uncertain =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_uncertain), total)
      : clamp(num(pipeline.website_verification_outcome_counts?.uncertain), total);
  const notUsable =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_not_usable), total)
      : clamp(num(pipeline.website_verification_outcome_counts?.not_usable), total);
  const error =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_error), total)
      : clamp(num(pipeline.website_verification_outcome_counts?.error), total);
  const processed = clamp(num(progress.companies_processed), total);
  const pending = Math.max(0, total - processed);
  const skipped = Math.max(
    0,
    job.status === 'queued' || job.status === 'running'
      ? num(progress.outcome_skipped)
      : num(pipeline.website_verification_outcome_counts?.skipped),
  );
  const ringTotal = Math.max(total + skipped, pending + usable + uncertain + notUsable + error + skipped);

  return (
    <Card variant="card" className="flex-1 min-w-[220px]">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Website verify</Text>
      <MultiSegmentDial
        total={Math.max(ringTotal, 1)}
        size={132}
        strokeWidth={10}
        centerValue={processed}
        centerTotal={Math.max(total, 1)}
        centerTopLabel="Processed"
        centerBottomLabel="Companies"
        segments={[
          { value: pending, color: '#6B7280' },
          { value: usable, color: '#10B981' },
          { value: uncertain, color: '#8B5CF6' },
          { value: notUsable, color: '#F59E0B' },
          { value: error, color: '#EF4444' },
          { value: skipped, color: '#3B82F6' },
        ]}
        legend={{
          placement: 'bottom',
          rows: [
            { label: 'Pending', value: pending, color: '#6B7280' },
            { label: 'Usable', value: usable, color: '#10B981' },
            { label: 'Uncertain', value: uncertain, color: '#8B5CF6' },
            { label: 'Not usable', value: notUsable, color: '#F59E0B' },
            { label: 'Error', value: error, color: '#EF4444' },
            { label: 'Skipped', value: skipped, color: '#3B82F6' },
          ],
        }}
      />
      <Text className="text-gray-500 font-instrument text-xs mt-2">Status: {jobStatusLabel(job)}</Text>
    </Card>
  );
}

function GoogleAdsVerificationDialCard({
  pipeline,
}: {
  pipeline: IngestionRunPipelineJobsResponse;
}) {
  const job = pipeline.google_ads_verification_job;
  if (!job) {
    return (
      <Card variant="card" className="flex-1 min-w-[220px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Google Ads</Text>
        <Text className="text-white font-instrument-semibold text-sm mb-2">Google Ads verification not started</Text>
        <Text className="text-gray-500 font-instrument text-xs leading-5">
          Run this manually after website verification when you want to confirm whether the verified domain appears in
          Google’s ads index.
        </Text>
      </Card>
    );
  }

  const progress = progressOf(job);
  const total = Math.max(0, Math.floor(Number(progress.in_scope_total) || 0));
  const yes =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_yes), total)
      : clamp(num(pipeline.google_ads_verification_outcome_counts?.yes), total);
  const no =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_no), total)
      : clamp(num(pipeline.google_ads_verification_outcome_counts?.no), total);
  const unknown =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_unknown), total)
      : clamp(num(pipeline.google_ads_verification_outcome_counts?.unknown), total);
  const error =
    job.status === 'queued' || job.status === 'running'
      ? clamp(num(progress.outcome_error), total)
      : clamp(num(pipeline.google_ads_verification_outcome_counts?.error), total);
  const processed = clamp(num(progress.companies_processed), total);
  const pending = Math.max(0, total - processed);
  const skipped = Math.max(
    0,
    job.status === 'queued' || job.status === 'running'
      ? num(progress.outcome_skipped)
      : num(pipeline.google_ads_verification_outcome_counts?.skipped),
  );
  const ringTotal = Math.max(total + skipped, pending + yes + no + unknown + error + skipped);

  return (
    <Card variant="card" className="flex-1 min-w-[220px]">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Google Ads</Text>
      <MultiSegmentDial
        total={Math.max(ringTotal, 1)}
        size={132}
        strokeWidth={10}
        centerValue={processed}
        centerTotal={Math.max(total, 1)}
        centerTopLabel="Processed"
        centerBottomLabel="Companies"
        segments={[
          { value: pending, color: '#6B7280' },
          { value: yes, color: '#10B981' },
          { value: no, color: '#F59E0B' },
          { value: unknown, color: '#8B5CF6' },
          { value: error, color: '#EF4444' },
          { value: skipped, color: '#3B82F6' },
        ]}
        legend={{
          placement: 'bottom',
          rows: [
            { label: 'Pending', value: pending, color: '#6B7280' },
            { label: 'Yes', value: yes, color: '#10B981' },
            { label: 'No', value: no, color: '#F59E0B' },
            { label: 'Unknown', value: unknown, color: '#8B5CF6' },
            { label: 'Error', value: error, color: '#EF4444' },
            { label: 'Skipped', value: skipped, color: '#3B82F6' },
          ],
        }}
      />
      <Text className="text-gray-500 font-instrument text-xs mt-2">Status: {jobStatusLabel(job)}</Text>
    </Card>
  );
}

export function ImportPipelineDials({ ingestionRunId }: Props) {
  const [pipeline, setPipeline] = useState<IngestionRunPipelineJobsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsRefreshing(true);
    try {
      const response = await fetchIngestionRunPipelineJobs(ingestionRunId);
      setPipeline(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline jobs');
    } finally {
      setIsRefreshing(false);
    }
  }, [ingestionRunId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load();
      }, 60_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const cards = useMemo(() => {
    if (!pipeline) return null;

    const normalizeProgress = progressOf(pipeline.normalize_job);
    const normalizeTotal = Math.max(num(normalizeProgress.total_rows), pipeline.total_source_rows);
    const normalizeDone = clamp(num(normalizeProgress.normalized_done ?? normalizeProgress.processed), normalizeTotal);
    const normalizePending = Math.max(0, normalizeTotal - normalizeDone);

    const autolinkProgress = progressOf(pipeline.autolink_job);
    const autolinkTotal = Math.max(num(autolinkProgress.total_rows), pipeline.total_source_rows);
    const autolinkLinked = clamp(num(autolinkProgress.outcome_linked), autolinkTotal);
    const autolinkReview = clamp(num(autolinkProgress.outcome_needs_review), autolinkTotal);
    const autolinkFailed = clamp(num(autolinkProgress.outcome_failed), autolinkTotal);
    const autolinkSkipped = clamp(num(autolinkProgress.outcome_skipped), autolinkTotal);
    const autolinkProcessed = clamp(num(autolinkProgress.rows_processed), autolinkTotal);
    const autolinkPending = Math.max(0, autolinkTotal - autolinkProcessed);

    return (
      <View className="gap-4">
        <View className="flex-row flex-wrap gap-4">
          <Card variant="card" className="flex-1 min-w-[220px]">
            <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Normalize</Text>
            <MultiSegmentDial
              total={normalizeTotal}
              size={132}
              strokeWidth={10}
              centerValue={normalizeDone}
              centerTotal={normalizeTotal}
              centerTopLabel="Done"
              centerBottomLabel="Rows"
              segments={[
                { value: normalizePending, color: '#6B7280' },
                { value: normalizeDone, color: '#10B981' },
              ]}
              legend={{
                placement: 'bottom',
                rows: [
                  { label: 'Pending', value: normalizePending, color: '#6B7280' },
                  { label: 'Done', value: normalizeDone, color: '#10B981' },
                ],
              }}
            />
            <Text className="text-gray-500 font-instrument text-xs mt-2">
              Status: {jobStatusLabel(pipeline.normalize_job)}
            </Text>
          </Card>

          <Card variant="card" className="flex-1 min-w-[220px]">
            <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Auto-link</Text>
            <MultiSegmentDial
              total={autolinkTotal}
              size={132}
              strokeWidth={10}
              centerValue={autolinkProcessed}
              centerTotal={autolinkTotal}
              centerTopLabel="Processed"
              centerBottomLabel="Rows"
              segments={[
                { value: autolinkPending, color: '#6B7280' },
                { value: autolinkLinked, color: '#10B981' },
                { value: autolinkReview, color: '#EAB308' },
                { value: autolinkFailed, color: '#EF4444' },
                { value: autolinkSkipped, color: '#F97316' },
              ]}
              legend={{
                placement: 'bottom',
                rows: [
                  { label: 'Pending', value: autolinkPending, color: '#6B7280' },
                  { label: 'Done', value: autolinkLinked, color: '#10B981' },
                  { label: 'Needs review', value: autolinkReview, color: '#EAB308' },
                  { label: 'Failed', value: autolinkFailed, color: '#EF4444' },
                  { label: 'Skipped', value: autolinkSkipped, color: '#F97316' },
                ],
              }}
            />
            <Text className="text-gray-500 font-instrument text-xs mt-2">
              Status: {jobStatusLabel(pipeline.autolink_job)}
            </Text>
          </Card>

          <ContactEnrichmentDialCard pipeline={pipeline} />

          <StateDialCard pipeline={pipeline} />

          <WebsiteVerificationDialCard pipeline={pipeline} />

          <GoogleAdsVerificationDialCard pipeline={pipeline} />

          <Card variant="card" className="flex-1 min-w-[220px]">
            <Text className="text-xs text-gray-500 uppercase tracking-wider mb-2">Queue</Text>
            <View className="items-center justify-center min-h-[132px]">
              <Text className="text-white font-instrument-semibold text-5xl">
                {queueCountLabel(pipeline.queue_pending_tasks)}
              </Text>
              <Text className="text-gray-500 font-instrument text-xs mt-2">
                {pipeline.queue_pending_tasks == null ? 'Queue count unavailable' : 'Pending review tasks'}
              </Text>
            </View>
          </Card>
        </View>
      </View>
    );
  }, [pipeline]);

  return (
    <Card variant="card">
      <View className="flex-row items-center justify-between mb-3">
        <View>
          <Text className="text-xs text-gray-500 uppercase tracking-wider">Pipeline progress</Text>
          <Text className="text-gray-400 font-instrument text-sm mt-1">
            Auto-refreshes every 60 seconds while this page is focused.
          </Text>
        </View>
        <Button variant="secondary" size="sm" disabled={isRefreshing} onPress={() => void load()}>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </View>

      {error ? <Text className="text-red-400 font-instrument text-sm mb-3">{error}</Text> : null}
      {cards ?? <Text className="text-gray-500 font-instrument text-sm">Loading pipeline progress…</Text>}
    </Card>
  );
}
