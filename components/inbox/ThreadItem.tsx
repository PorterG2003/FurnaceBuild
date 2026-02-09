import { Pressable, Text } from 'react-native';
import type { EmailThread } from '@/lib/supabase/types';
import { formatThreadDate } from '@/lib/inbox';

export function ThreadItem({
  thread,
  isSelected,
  onSelect,
}: {
  thread: EmailThread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      className="mx-3 mb-2 rounded-xl px-4 py-3"
      style={[
        { borderWidth: 1 },
        isSelected
          ? { backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' }
          : { backgroundColor: '#121212', borderColor: '#2A2A2A' },
      ]}
    >
      <Text
        className="font-instrument-semibold text-base text-white mb-1"
        numberOfLines={1}
      >
        {thread.subject || '(No subject)'}
      </Text>
      <Text className="text-gray-400 font-instrument text-sm mb-2" numberOfLines={1}>
        {thread.participants?.length ? thread.participants.join(', ') : '—'}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs">
        {formatThreadDate(thread.last_message_at)} · {thread.message_count} message{thread.message_count !== 1 ? 's' : ''}
      </Text>
    </Pressable>
  );
}
