import { View, Pressable, Text } from 'react-native';
import type { EmailThread } from '@/lib/supabase/types';
import { formatThreadDate } from '@/lib/inbox';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export function ThreadItem({
  thread,
  isSelected,
  onSelect,
  unreadCount = 0,
  tags = [],
}: {
  thread: EmailThread;
  isSelected: boolean;
  onSelect: () => void;
  unreadCount?: number;
  tags?: ThreadTag[];
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
      <View className="flex-row items-center justify-between gap-2">
        <Text
          className="font-instrument-semibold text-base text-white mb-1 flex-1"
          numberOfLines={1}
        >
          {thread.subject || '(No subject)'}
        </Text>
        {unreadCount > 0 && (
          <View
            className="min-w-[20px] h-5 rounded-full bg-orange-500 items-center justify-center px-1.5"
          >
            <Text className="text-white font-instrument-bold text-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </View>
        )}
      </View>
      <Text className="text-gray-400 font-instrument text-sm mb-2" numberOfLines={1}>
        {thread.participants?.length ? thread.participants.join(', ') : '—'}
      </Text>
      {thread.category && (
        <View className="rounded px-2 py-0.5 self-start mb-1" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
          <Text className="text-xs font-instrument text-indigo-400">{thread.category}</Text>
        </View>
      )}
      {tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1 mb-1">
          {tags.slice(0, 3).map((tag) => (
            <View
              key={tag.id}
              className="rounded px-2 py-0.5"
              style={{ backgroundColor: tag.color || 'rgba(243, 68, 13, 0.2)' }}
            >
              <Text className="text-xs font-instrument text-orange-400">{tag.name}</Text>
            </View>
          ))}
          {tags.length > 3 && (
            <Text className="text-xs font-instrument text-gray-500">+{tags.length - 3}</Text>
          )}
        </View>
      )}
      <Text className="text-gray-500 font-instrument text-xs">
        {formatThreadDate(thread.last_message_at)} · {thread.message_count} message{thread.message_count !== 1 ? 's' : ''}
      </Text>
    </Pressable>
  );
}
