import { Text, View } from 'react-native';
import { EllipsisVerticalIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { MailboxStatusPill } from './mailboxStatus';
import type { Mailbox } from '@/lib/supabase/types';

export interface MailboxListCardProps {
  mailbox: Mailbox;
  onPressMenu: () => void;
}

export function MailboxListCard({ mailbox, onPressMenu }: MailboxListCardProps) {
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
    </View>
  );
}
