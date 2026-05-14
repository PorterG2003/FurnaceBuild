import { Text, View } from 'react-native';
import { PencilIcon, PlayIcon, TrashIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { formatMailboxLastSent, formatMailboxMinGap, formatMailboxUsage } from '@/lib/mailboxes/overview-format';
import { MailboxStatusPill } from './MailboxStatusPill';
import type { TableColumn } from '@/components/ui/DataTable';
import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';

interface BuildMailboxOverviewColumnsOptions {
  emailLabel?: string;
  todayLabel?: string;
  includeActions?: boolean;
  testingMailboxId?: string | null;
  onTestMailbox?: (mailbox: MailboxOverview) => void;
  onEditMailbox?: (mailbox: MailboxOverview) => void;
  onDeleteMailbox?: (mailbox: MailboxOverview) => void;
}

export function buildMailboxOverviewColumns({
  emailLabel = 'Email Address',
  todayLabel = 'Today Sent',
  includeActions = false,
  testingMailboxId = null,
  onTestMailbox,
  onEditMailbox,
  onDeleteMailbox,
}: BuildMailboxOverviewColumnsOptions = {}): TableColumn<MailboxOverview>[] {
  const columns: TableColumn<MailboxOverview>[] = [
    {
      key: 'displayName',
      label: 'Display Name',
      minWidth: 180,
      flex: 2,
      render: (mailbox) => (
        <Text className="text-white font-instrument-medium text-sm" numberOfLines={2}>
          {mailbox.display_name || mailbox.email_address}
        </Text>
      ),
    },
    {
      key: 'email',
      label: emailLabel,
      minWidth: 240,
      flex: 2.2,
      render: (mailbox) => (
        <Text className="text-gray-400 font-instrument text-sm" numberOfLines={2}>
          {mailbox.email_address}
        </Text>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      minWidth: 120,
      flex: 1.1,
      render: (mailbox) => <MailboxStatusPill status={mailbox.status} />,
    },
    {
      key: 'minGap',
      label: 'Min Gap',
      minWidth: 90,
      flex: 1,
      render: (mailbox) => (
        <Text className="text-white font-instrument text-sm">
          {formatMailboxMinGap(mailbox.effectiveMinGapSeconds)}
        </Text>
      ),
    },
    {
      key: 'today',
      label: todayLabel,
      minWidth: 96,
      flex: 1,
      render: (mailbox) => (
        <Text className="text-white font-instrument text-sm">
          {formatMailboxUsage(mailbox.throttleTodaySent, mailbox.effectiveDailyLimit)}
        </Text>
      ),
    },
    {
      key: 'thisHour',
      label: 'This Hour',
      minWidth: 96,
      flex: 1,
      render: (mailbox) => (
        <Text className="text-white font-instrument text-sm">
          {formatMailboxUsage(mailbox.throttleThisHourSent, mailbox.effectiveHourlyLimit)}
        </Text>
      ),
    },
    {
      key: 'activeCampaigns',
      label: 'Active Campaigns',
      minWidth: 124,
      flex: 1.1,
      render: (mailbox) => (
        <Text
          className={`font-instrument-medium text-sm ${
            mailbox.activeCampaignCount > 0 ? 'text-[#FF9A6B]' : 'text-white'
          }`}
        >
          {mailbox.activeCampaignCount}
        </Text>
      ),
    },
    {
      key: 'lastSent',
      label: 'Last Sent',
      minWidth: 164,
      flex: 1.4,
      render: (mailbox) => (
        <Text className="text-gray-300 font-instrument text-sm" numberOfLines={2}>
          {formatMailboxLastSent(mailbox.throttleLastSentAt)}
        </Text>
      ),
    },
  ];

  if (!includeActions) return columns;

  columns.push({
    key: 'actions',
    label: 'Actions',
    minWidth: 234,
    flex: 1.8,
    render: (mailbox) => (
      <View className="flex-row gap-1.5">
        <IconButton
          variant="secondary"
          size="sm"
          icon={PlayIcon}
          label={testingMailboxId === mailbox.id ? 'Testing...' : 'Test'}
          onPress={() => onTestMailbox?.(mailbox)}
          disabled={testingMailboxId === mailbox.id}
        />
        <IconButton
          variant="secondary"
          size="sm"
          icon={PencilIcon}
          onPress={() => onEditMailbox?.(mailbox)}
        />
        <IconButton
          variant="destructive"
          size="sm"
          icon={TrashIcon}
          onPress={() => onDeleteMailbox?.(mailbox)}
        />
      </View>
    ),
  });

  return columns;
}
