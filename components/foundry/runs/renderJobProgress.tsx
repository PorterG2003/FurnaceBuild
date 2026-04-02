import { Text, View } from 'react-native';
import type { FoundryJobProgress } from '@/lib/foundry/registry-types';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row flex-wrap gap-x-2 py-1 border-b border-[#2A2A2A]">
      <Text className="text-gray-500 font-instrument text-xs w-36 shrink-0">{label}</Text>
      <Text className="text-gray-200 font-instrument text-xs flex-1 min-w-[120px]">{value}</Text>
    </View>
  );
}

export function RenderJobProgressSummary({ progress }: { progress: FoundryJobProgress | null | undefined }) {
  if (!progress || typeof progress !== 'object') {
    return <Text className="text-gray-500 font-instrument text-sm">No progress data.</Text>;
  }

  const rows: { label: string; value: string }[] = [];
  if (progress.current_step != null) rows.push({ label: 'Current step', value: String(progress.current_step) });
  if (progress.total != null) rows.push({ label: 'Total', value: String(progress.total) });
  if (progress.total_targets != null) rows.push({ label: 'Total targets', value: String(progress.total_targets) });
  if (progress.processed != null) rows.push({ label: 'Processed', value: String(progress.processed) });
  if (progress.targets_processed != null) rows.push({ label: 'Processed targets', value: String(progress.targets_processed) });
  if (progress.succeeded != null) rows.push({ label: 'Succeeded', value: String(progress.succeeded) });
  if (progress.failed != null) rows.push({ label: 'Failed', value: String(progress.failed) });
  if (progress.skipped != null) rows.push({ label: 'Skipped', value: String(progress.skipped) });
  if (progress.outcome_accepted != null) rows.push({ label: 'Accepted', value: String(progress.outcome_accepted) });
  if (progress.outcome_accepted_by_ruleset != null) {
    rows.push({ label: 'Accepted (ruleset)', value: String(progress.outcome_accepted_by_ruleset) });
  }
  if (progress.outcome_ambiguous != null) rows.push({ label: 'Ambiguous', value: String(progress.outcome_ambiguous) });
  if (progress.outcome_ambiguous_reviewable != null) {
    rows.push({ label: 'Ambiguous (reviewable)', value: String(progress.outcome_ambiguous_reviewable) });
  }
  if (progress.outcome_ambiguous_low_signal != null) {
    rows.push({ label: 'Ambiguous (low signal)', value: String(progress.outcome_ambiguous_low_signal) });
  }
  if (progress.outcome_no_match != null) rows.push({ label: 'No match', value: String(progress.outcome_no_match) });
  if (progress.outcome_error != null) rows.push({ label: 'Error', value: String(progress.outcome_error) });
  if (progress.outcome_skipped_recent != null) {
    rows.push({ label: 'Skipped recent', value: String(progress.outcome_skipped_recent) });
  }
  if (progress.cursor != null) rows.push({ label: 'Cursor', value: String(progress.cursor) });
  if (progress.last_chunk != null) {
    rows.push({
      label: 'Last chunk',
      value: JSON.stringify(progress.last_chunk),
    });
  }
  if (progress.utah_count != null) rows.push({ label: 'Utah companies', value: String(progress.utah_count) });
  if (progress.florida_count != null) rows.push({ label: 'Florida companies', value: String(progress.florida_count) });

  if (rows.length === 0) {
    return <Text className="text-gray-500 font-instrument text-sm">No structured progress fields.</Text>;
  }

  return (
    <View>
      {rows.map((r) => (
        <Row key={r.label} label={r.label} value={r.value} />
      ))}
    </View>
  );
}

export function UtahPerCompanyBlock({ items }: { items: unknown[] }) {
  const text = JSON.stringify(items, null, 2);
  return (
    <View className="mt-3">
      <Text className="text-gray-500 font-instrument text-xs mb-1">Utah per company (technical)</Text>
      <Text className="text-gray-300 font-mono text-[10px] leading-4 bg-[#121212] p-2 rounded border border-[#2A2A2A]">
        {text.length > 8000 ? `${text.slice(0, 8000)}…` : text}
      </Text>
    </View>
  );
}

export function FloridaPerCompanyBlock({ items }: { items: unknown[] }) {
  const text = JSON.stringify(items, null, 2);
  return (
    <View className="mt-3">
      <Text className="text-gray-500 font-instrument text-xs mb-1">Florida per company (technical)</Text>
      <Text className="text-gray-300 font-mono text-[10px] leading-4 bg-[#121212] p-2 rounded border border-[#2A2A2A]">
        {text.length > 8000 ? `${text.slice(0, 8000)}…` : text}
      </Text>
    </View>
  );
}
