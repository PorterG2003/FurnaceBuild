import { Text, View } from 'react-native';
import { CheckIcon, XMarkIcon } from 'react-native-heroicons/outline';
import type { TableColumn } from '@/components/ui/DataTable';
import { getLeadDisplayName } from '@/lib/leads';
import type { CampaignMigrationResult } from '@/lib/smartlead/migration';
import type { EmailThread, Lead } from '@/lib/supabase/types';
import { DEFAULT_STATUS_STYLE, STATUS_STYLES } from '../constants';
import type { CampaignRow } from '../types';
import {
  conversationZeroReason,
  formatCount,
  formatDateTime,
  formatParticipants,
} from '../utils';

export function MigrationCheckCell({ value }: { value: boolean }) {
  return (
    <View className="flex-1 items-center justify-center">
      {value ? (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
          <CheckIcon size={12} color="#22c55e" />
        </View>
      ) : (
        <View className="h-5 w-5 items-center justify-center rounded-full bg-neutral-700/60">
          <XMarkIcon size={12} color="#6B7280" />
        </View>
      )}
    </View>
  );
}

export const campaignSelectionColumns: TableColumn<CampaignRow>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 1,
    render: (row) => (
      <View className="flex-row items-center">
        {row.depth === 1 && <Text className="text-gray-600 text-sm mr-1.5">↳</Text>}
        <Text
          className={`text-sm ${row.depth === 1 ? 'text-gray-300 font-instrument' : 'text-white font-instrument-medium'}`}
          numberOfLines={1}
        >
          {row.campaign.name || `Campaign #${row.campaign.id}`}
        </Text>
      </View>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    minWidth: 160,
    maxWidth: 160,
    render: (row) => {
      if (!row.campaign.status) return null;
      const style = STATUS_STYLES[row.campaign.status.toUpperCase()] ?? DEFAULT_STATUS_STYLE;
      return (
        <View className={`self-start px-2 py-0.5 rounded ${style.bg} border ${style.border}`}>
          <Text className={`text-xs font-instrument-medium capitalize ${style.text}`}>
            {row.campaign.status.toLowerCase()}
          </Text>
        </View>
      );
    },
  },
];

export const migrationResultColumns: TableColumn<CampaignMigrationResult>[] = [
  {
    key: 'campaign',
    label: 'Campaign',
    flex: 2,
    render: (row) => (
      <Text
        className={`text-sm font-instrument-medium ${row.status === 'succeeded' ? 'text-white' : 'text-red-300'}`}
        numberOfLines={1}
      >
        {row.campaignName}
      </Text>
    ),
  },
  {
    key: 'leads',
    label: 'Leads',
    minWidth: 72,
    maxWidth: 72,
    render: (row) => (
      <Text className="text-neutral-300 text-xs font-instrument text-center w-full">
        {row.status === 'succeeded' ? String(row.leadsImported ?? 0) : '—'}
      </Text>
    ),
  },
  {
    key: 'conversations',
    label: 'Conv',
    minWidth: 72,
    maxWidth: 72,
    render: (row) => {
      if (row.status !== 'succeeded') {
        return <Text className="text-neutral-500 text-xs font-instrument text-center w-full">—</Text>;
      }
      const count = row.conversationsImported ?? 0;
      const reason = conversationZeroReason(row.conversationDiagnostics);
      return (
        <View className="items-center justify-center w-full">
          <Text className="text-neutral-300 text-xs font-instrument">{String(count)}</Text>
          {count === 0 && reason && (
            <Text className="text-neutral-500 text-[10px] font-instrument mt-0.5" numberOfLines={1}>
              {reason}
            </Text>
          )}
        </View>
      );
    },
  },
  {
    key: 'totals',
    label: 'Totals',
    minWidth: 72,
    maxWidth: 72,
    render: (row) => <MigrationCheckCell value={row.status === 'succeeded' ? (row.totalsStatsImported ?? false) : false} />,
  },
  {
    key: 'daily',
    label: 'Daily',
    minWidth: 72,
    maxWidth: 72,
    render: (row) => <MigrationCheckCell value={row.status === 'succeeded' ? (row.dayByDayStatsImported ?? false) : false} />,
  },
  {
    key: 'notes',
    label: 'Error',
    flex: 3,
    render: (row) => (
      <Text
        className={`text-xs font-instrument ${row.status === 'failed' ? 'text-red-400/80' : 'text-neutral-600'}`}
        numberOfLines={2}
      >
        {row.status === 'failed' ? (row.error ?? '') : ''}
      </Text>
    ),
  },
];

export const migrationStatsColumns: TableColumn<CampaignMigrationResult>[] = [
  migrationResultColumns[0],
  migrationResultColumns[3],
  migrationResultColumns[4],
];

export const migrationLeadColumns: TableColumn<Lead>[] = [
  {
    key: 'email',
    label: 'Email',
    flex: 2,
    render: (lead) => (
      <Text className="text-sm text-white font-instrument-medium" numberOfLines={1}>
        {lead.email ?? '—'}
      </Text>
    ),
  },
  {
    key: 'name',
    label: 'Name',
    flex: 1.5,
    render: (lead) => (
      <Text className="text-xs text-neutral-300 font-instrument" numberOfLines={1}>
        {getLeadDisplayName(lead) || '—'}
      </Text>
    ),
  },
  {
    key: 'created',
    label: 'Imported',
    minWidth: 160,
    maxWidth: 160,
    render: (lead) => (
      <Text className="text-xs text-neutral-400 font-instrument" numberOfLines={1}>
        {formatDateTime(lead.created_at)}
      </Text>
    ),
  },
];

export const migrationConversationColumns: TableColumn<EmailThread>[] = [
  {
    key: 'subject',
    label: 'Subject',
    flex: 2,
    render: (thread) => (
      <Text className="text-sm text-white font-instrument-medium" numberOfLines={1}>
        {thread.subject || 'No subject'}
      </Text>
    ),
  },
  {
    key: 'participants',
    label: 'Participants',
    flex: 1.5,
    render: (thread) => (
      <Text className="text-xs text-neutral-300 font-instrument" numberOfLines={1}>
        {formatParticipants(thread.participants)}
      </Text>
    ),
  },
  {
    key: 'lastMessage',
    label: 'Last Message',
    minWidth: 160,
    maxWidth: 160,
    render: (thread) => (
      <Text className="text-xs text-neutral-400 font-instrument" numberOfLines={1}>
        {formatDateTime(thread.last_message_at)}
      </Text>
    ),
  },
  {
    key: 'messageCount',
    label: 'Messages',
    minWidth: 84,
    maxWidth: 84,
    render: (thread) => (
      <Text className="text-xs text-neutral-300 font-instrument text-center w-full">
        {formatCount(thread.message_count)}
      </Text>
    ),
  },
];

