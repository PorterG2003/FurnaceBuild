import { View, Text } from 'react-native';
import type { FoundryJobStatus } from '@/lib/foundry/registry-types';
import { FOUNDRY_JOB_STATUSES } from '@/lib/foundry/registry-types';

function isFoundryJobStatus(s: string): s is FoundryJobStatus {
  return (FOUNDRY_JOB_STATUSES as readonly string[]).includes(s);
}

function badgeStyles(status: string): { bg: string; text: string; label: string } {
  if (!isFoundryJobStatus(status)) {
    return { bg: 'bg-[#2A2A2A]', text: 'text-gray-300', label: status };
  }
  switch (status) {
    case 'queued':
      return { bg: 'bg-amber-500/15', text: 'text-amber-300', label: 'Queued' };
    case 'running':
      return { bg: 'bg-sky-500/15', text: 'text-sky-300', label: 'Running' };
    case 'completed':
      return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Completed' };
    case 'failed':
      return { bg: 'bg-red-500/15', text: 'text-red-300', label: 'Failed' };
    case 'cancelled':
      return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Cancelled' };
    default:
      return { bg: 'bg-[#2A2A2A]', text: 'text-gray-300', label: status };
  }
}

export function FoundryJobStatusBadge({ status }: { status: string }) {
  const { bg, text, label } = badgeStyles(status);
  return (
    <View className={`px-2 py-0.5 rounded-md self-start ${bg}`}>
      <Text className={`font-instrument text-xs ${text}`}>{label}</Text>
    </View>
  );
}
