import { ActivityIndicator, Text, View } from 'react-native';
import {
  EllipsisHorizontalIcon,
  PencilIcon,
  PlayIcon,
  TagIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import { RowOverflowMenu } from '@/components/ui/RowOverflowMenu';
import { TagChipRow } from '@/components/tags';
import { formatMailboxLastSent, formatMailboxMinGap, formatMailboxUsage } from '@/lib/mailboxes/overview-format';
import { MailboxStatusPill } from './MailboxStatusPill';
import type { TableColumn } from '@/components/ui/DataTable';
import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';
import type { MailboxTag } from '@/lib/supabase/services/mailbox-tags';

interface BuildMailboxOverviewColumnsOptions {
  emailLabel?: string;
  todayLabel?: string;
  includeActions?: boolean;
  testingMailboxId?: string | null;
  mailboxTagsMap?: Record<string, MailboxTag[]>;
  onTestMailbox?: (mailbox: MailboxOverview) => void;
  onEditMailbox?: (mailbox: MailboxOverview) => void;
  onDeleteMailbox?: (mailbox: MailboxOverview) => void;
  onManageTags?: (mailbox: MailboxOverview) => void;
}

export function buildMailboxOverviewColumns({
  emailLabel = 'Email Address',
  todayLabel = 'Today Sent',
  includeActions = false,
  testingMailboxId = null,
  mailboxTagsMap = {},
  onTestMailbox,
  onEditMailbox,
  onDeleteMailbox,
  onManageTags,
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
      minWidth: 280,
      flex: 2.7,
      render: (mailbox) => (
        <View className="gap-2">
          <Text className="text-gray-400 font-instrument text-sm" numberOfLines={2}>
            {mailbox.email_address}
          </Text>
          <TagChipRow tags={mailboxTagsMap[mailbox.id] ?? []} maxVisible={3} />
        </View>
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
    minWidth: 100,
    flex: 0.8,
    align: 'end',
    render: (mailbox) => {
      if (testingMailboxId === mailbox.id) {
        return (
          <View className="flex-row items-center gap-2 justify-end">
            <ActivityIndicator size="small" color="#F3440D" />
            <Text className="text-gray-400 font-instrument text-sm">Testing…</Text>
          </View>
        );
      }

      return (
        <RowOverflowMenu
          items={[
            {
              key: 'test',
              label: 'Test connection',
              icon: PlayIcon,
              onPress: () => onTestMailbox?.(mailbox),
            },
            {
              key: 'tags',
              label: 'Manage tags',
              icon: TagIcon,
              onPress: () => onManageTags?.(mailbox),
            },
            {
              key: 'edit',
              label: 'Edit mailbox',
              icon: PencilIcon,
              onPress: () => onEditMailbox?.(mailbox),
            },
            {
              key: 'delete',
              label: 'Delete mailbox',
              icon: TrashIcon,
              tone: 'destructive',
              onPress: () => onDeleteMailbox?.(mailbox),
            },
          ]}
          menuMinWidth={184}
          triggerIcon={EllipsisHorizontalIcon}
          triggerAccessibilityLabel="Mailbox actions"
          horizontalAlign="end"
          sheetTitle={mailbox.display_name || mailbox.email_address}
        />
      );
    },
  });

  return columns;
}
