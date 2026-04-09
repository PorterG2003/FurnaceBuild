import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/Checkbox';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import {
  fetchCurrentCostRate,
  postContactEnrichmentPreflight,
  postStartContactEnrichmentIngestionJob,
} from '@/lib/foundry/registry-client';
import type {
  ContactEnrichmentPreflightResponse,
  ContactEnrichmentRulesetPreset,
} from '@/lib/foundry/registry-types';

const FRESHNESS_OPTIONS = [30, 60, 90, 180] as const;

const RULESET_OPTIONS: { value: ContactEnrichmentRulesetPreset; label: string; hint: string }[] = [
  { value: 'conservative', label: 'Conservative', hint: 'Stricter auto-accept; more ambiguous outcomes.' },
  { value: 'balanced', label: 'Balanced', hint: 'Default. Uses employer + address + name evidence.' },
  { value: 'aggressive', label: 'Aggressive', hint: 'More auto-accepts when evidence lines up.' },
];

type DraftOptions = {
  freshness_window_days: number;
  strong_targets_only: boolean;
  force_rerun_recent: boolean;
  ruleset_preset: ContactEnrichmentRulesetPreset;
  queue_ambiguous_for_review: boolean;
};

function ToggleRow({
  label,
  hint,
  checked,
  onPress,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-start gap-3 rounded-xl border border-[#3A3A3A] bg-[#202020] px-3 py-3">
      <Checkbox checked={checked} onPress={onPress} />
      <View className="flex-1 min-w-0">
        <Text className="text-white font-instrument-semibold text-sm">{label}</Text>
        <Text className="text-gray-400 font-instrument text-sm mt-1 leading-5">{hint}</Text>
      </View>
    </Pressable>
  );
}

function FreshnessOption({
  value,
  selected,
  onPress,
}: {
  value: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-2 rounded-xl border ${
        selected ? 'border-brand-orange bg-[#241814]' : 'border-[#3A3A3A] bg-[#202020]'
      }`}
    >
      <Text className={`font-instrument-semibold text-sm ${selected ? 'text-white' : 'text-gray-300'}`}>{value} days</Text>
    </Pressable>
  );
}

function RulesetChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-2 rounded-xl border ${
        selected ? 'border-brand-orange bg-[#241814]' : 'border-[#3A3A3A] bg-[#202020]'
      }`}
    >
      <Text className={`font-instrument-semibold text-sm ${selected ? 'text-white' : 'text-gray-300'}`}>{label}</Text>
    </Pressable>
  );
}

function formatCounts(preflight: ContactEnrichmentPreflightResponse | null): Array<{ label: string; value: number }> {
  if (!preflight) return [];
  const counts = preflight.counts;
  return [
    { label: 'Eligible', value: counts.eligible },
    { label: 'Skipped recent', value: counts.skipped_recent_lookup },
    { label: 'Missing person name', value: counts.skipped_missing_person_name },
    { label: 'Missing address', value: counts.skipped_missing_address },
    { label: 'No current owner', value: counts.skipped_no_current_owner },
    { label: 'Suppressed', value: counts.skipped_suppressed },
    { label: 'Not ready', value: counts.skipped_not_ready },
  ].filter((row) => row.value > 0 || row.label === 'Eligible');
}

export function ContactEnrichmentPanel({ ingestionRunId }: { ingestionRunId: string }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ContactEnrichmentPreflightResponse | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [startedReused, setStartedReused] = useState(false);
  const [draft, setDraft] = useState<DraftOptions>({
    freshness_window_days: 90,
    strong_targets_only: true,
    force_rerun_recent: false,
    ruleset_preset: 'balanced',
    queue_ambiguous_for_review: false,
  });
  const [costLookupInput, setCostLookupInput] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void fetchCurrentCostRate({
      cost_kind: 'enrichment',
      provider: 'skipsherpa',
      product: 'person_lookup',
    })
      .then((res) => {
        if (cancelled) return;
        const cents = res.rate?.unitPriceCents;
        if (cents != null && Number.isFinite(cents)) {
          setCostLookupInput((prev) => (prev.trim() === '' ? String(Math.trunc(cents)) : prev));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadingPreflight(true);
    setError(null);
    void postContactEnrichmentPreflight(ingestionRunId, draft)
      .then((response) => {
        if (cancelled) return;
        setPreflight(response);
        setDraft((current) => {
          const nextPreset = response.options.ruleset_preset ?? current.ruleset_preset;
          const nextQueue =
            response.options.queue_ambiguous_for_review ?? current.queue_ambiguous_for_review;
          if (nextPreset === current.ruleset_preset && nextQueue === current.queue_ambiguous_for_review) {
            return current;
          }
          return { ...current, ruleset_preset: nextPreset, queue_ambiguous_for_review: nextQueue };
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setPreflight(null);
        setError(err instanceof Error ? err.message : 'Failed to build contact enrichment preview');
      })
      .finally(() => {
        if (!cancelled) setLoadingPreflight(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, ingestionRunId, visible]);

  const previewRows = useMemo(() => formatCounts(preflight), [preflight]);

  return (
    <View className="mt-4">
      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">Contact enrichment</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
        This stage is always manual. Review the preview first, choose a same-source freshness window, and only then
        start SkipSherpa lookups for resolved owner/person rows.
      </Text>

      {error ? <Text className="text-red-400 mb-2 font-instrument text-sm">{error}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          variant="default"
          size="sm"
          onPress={() => {
            setVisible(true);
            setError(null);
          }}
        >
          Enrich contacts
        </Button>
        <Button variant="link" size="sm" className="self-start px-0" onPress={() => router.push('/foundry/runs')}>
          Open Runs
        </Button>
      </View>

      {startedJobId ? (
        <Text className="text-emerald-300/90 font-instrument text-xs mt-3 leading-5">
          {startedReused ? 'Using existing contact enrichment job' : 'Started contact enrichment job'} {startedJobId}
        </Text>
      ) : null}

      <BaseModal
        visible={visible}
        onClose={() => {
          if (!busy) setVisible(false);
        }}
        title="Enrich contacts"
        description="Preview how many resolved owner/person rows are eligible before starting any paid lookups."
        maxWidth="lg"
        footer={
          <View className="flex-row flex-wrap gap-2 justify-end">
            <Button variant="secondary" disabled={busy} onPress={() => setVisible(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={busy || loadingPreflight || !preflight || preflight.counts.eligible === 0 || Boolean(preflight.active_job_id)}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  const costRaw = costLookupInput.trim();
                  const parsedCost = costRaw === '' ? NaN : Number.parseInt(costRaw, 10);
                  const costPerLookupCents = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : undefined;
                  const response = await postStartContactEnrichmentIngestionJob(ingestionRunId, {
                    ...draft,
                    ...(costPerLookupCents != null ? { cost_per_lookup_cents: costPerLookupCents } : {}),
                  });
                  setStartedJobId(response.jobId);
                  setStartedReused(Boolean(response.reused));
                  setPreflight(response.preflight);
                  setVisible(false);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to start contact enrichment');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Starting…' : 'Start enrichment'}
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <View>
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Freshness window</Text>
            <View className="flex-row flex-wrap gap-2">
              {FRESHNESS_OPTIONS.map((value) => (
                <FreshnessOption
                  key={value}
                  value={value}
                  selected={draft.freshness_window_days === value}
                  onPress={() => setDraft((current) => ({ ...current, freshness_window_days: value }))}
                />
              ))}
            </View>
          </View>

          <ToggleRow
            label="Strong targets only"
            hint="Default on. Restrict lookups to person-shaped owner names with enough signal for safer provider matching."
            checked={draft.strong_targets_only}
            onPress={() => setDraft((current) => ({ ...current, strong_targets_only: !current.strong_targets_only }))}
          />
          <ToggleRow
            label="Force rerun recent lookups"
            hint="Ignore the freshness guard and rerun even if the same source/target was enriched recently."
            checked={draft.force_rerun_recent}
            onPress={() => setDraft((current) => ({ ...current, force_rerun_recent: !current.force_rerun_recent }))}
          />

          <View>
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Match ruleset</Text>
            <View className="flex-row flex-wrap gap-2">
              {RULESET_OPTIONS.map((opt) => (
                <RulesetChip
                  key={opt.value}
                  label={opt.label}
                  selected={draft.ruleset_preset === opt.value}
                  onPress={() => setDraft((current) => ({ ...current, ruleset_preset: opt.value }))}
                />
              ))}
            </View>
            <Text className="text-gray-500 font-instrument text-xs mt-2 leading-5">
              {RULESET_OPTIONS.find((o) => o.value === draft.ruleset_preset)?.hint}
            </Text>
          </View>

          <ToggleRow
            label="Queue ambiguous for human review"
            hint="When on, reviewable ambiguous matches create a Foundry queue task so you can accept a candidate, reject, or suppress paid retries."
            checked={draft.queue_ambiguous_for_review}
            onPress={() =>
              setDraft((current) => ({ ...current, queue_ambiguous_for_review: !current.queue_ambiguous_for_review }))
            }
          />

          <View>
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">
              Cost per lookup (cents)
            </Text>
            <TextInput
              value={costLookupInput}
              onChangeText={setCostLookupInput}
              placeholder="e.g. 15"
              placeholderTextColor="#6b7280"
              keyboardType="number-pad"
              className="border border-[#3A3A3A] rounded-xl px-3 py-2.5 text-white font-instrument text-sm bg-[#202020]"
            />
            <Text className="text-gray-500 font-instrument text-xs mt-1 leading-5">
              Billable HTTP 2xx attempts use this rate. Leave blank to use the active rate card default.
            </Text>
          </View>

          <View className="rounded-2xl border border-[#2A2A2A] bg-[#161616] px-4 py-4">
            <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Preview</Text>
            {loadingPreflight ? (
              <Text className="text-gray-400 font-instrument text-sm">Loading preview…</Text>
            ) : preflight ? (
              <View className="gap-2">
                <Text className="text-gray-300 font-instrument text-sm leading-5">
                  Linked companies: {preflight.counts.linked_companies} · Candidate owner rows:{' '}
                  {preflight.counts.candidate_owner_rows}
                </Text>
                {previewRows.map((row) => (
                  <View key={row.label} className="flex-row items-center justify-between gap-3">
                    <Text className="text-gray-400 font-instrument text-sm">{row.label}</Text>
                    <Text className="text-white font-instrument-semibold text-sm">{row.value}</Text>
                  </View>
                ))}
                {preflight.active_job_id ? (
                  <Text className="text-amber-200/90 font-instrument text-xs leading-5 mt-2">
                    A contact enrichment job is already running for this import: {preflight.active_job_id}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text className="text-gray-400 font-instrument text-sm">No preview available yet.</Text>
            )}
          </View>
        </View>
      </BaseModal>
    </View>
  );
}
