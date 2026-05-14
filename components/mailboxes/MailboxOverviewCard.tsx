import { Text, View } from 'react-native';
import { EllipsisVerticalIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { formatMailboxLastSent, formatMailboxMinGap, formatMailboxUsage } from '@/lib/mailboxes/overview-format';
import { MailboxStatusPill } from './MailboxStatusPill';
import type { MailboxOverview } from '@/lib/supabase/services/mailboxes';

export interface MailboxOverviewCardProps {
  mailbox: MailboxOverview;
  onPressMenu: () => void;
}

export function MailboxOverviewCard({ mailbox, onPressMenu }: MailboxOverviewCardProps) {
  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 min-w-0 flex-row flex-wrap items-center gap-2">
          <Text
            className="min-w-0 text-white font-instrument-medium text-base"
            numberOfLines={2}
            style={{ flexGrow: 0, flexShrink: 1, flexBasis: 'auto' }}
          >
            {mailbox.display_name || mailbox.email_address}
          </Text>
          <View className="flex-shrink-0">
            <MailboxStatusPill status={mailbox.status} />
          </View>
        </View>
        <IconButton
          icon={EllipsisVerticalIcon}
          variant="overflow"
          onPress={onPressMenu}
          hitSlop={8}
          accessibilityLabel="Mailbox actions"
          className="flex-shrink-0"
        />
      </View>
      <Text
        className="text-gray-400 font-instrument text-sm mt-2 w-full"
        numberOfLines={2}
      >
        {mailbox.email_address}
      </Text>
      <View className="mt-3 gap-1.5">
        <Text className="text-gray-300 font-instrument text-xs">
          Daily {formatMailboxUsage(mailbox.throttleTodaySent, mailbox.effectiveDailyLimit)} | Hour {formatMailboxUsage(mailbox.throttleThisHourSent, mailbox.effectiveHourlyLimit)}
        </Text>
        <Text className="text-gray-400 font-instrument text-xs">
          Gap {formatMailboxMinGap(mailbox.effectiveMinGapSeconds)} | Campaigns {mailbox.activeCampaignCount} | Last sent {formatMailboxLastSent(mailbox.throttleLastSentAt)}
        </Text>
      </View>
    </View>
  );
}
