import { View, Pressable, Text } from 'react-native';
import type { EmailThread } from '@/lib/supabase/types';
import { formatThreadDateWithTime } from '@/lib/inbox';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export function ThreadItem({
  thread,
  isSelected,
  onSelect,
  isUnread = false,
  cardTitle,
  campaignName = null,
  preview = null,
  tags = [],
}: {
  thread: EmailThread;
  isSelected: boolean;
  onSelect: () => void;
  isUnread?: boolean;
  /** Lead name with fallback to email; used as the card title */
  cardTitle?: string;
  campaignName?: string | null;
  preview?: string | null;
  tags?: ThreadTag[];
}) {
  const topTag = thread.category
    ? { label: thread.category, bg: 'rgba(99, 102, 241, 0.2)', color: '#818CF8' }
    : tags.length > 0
      ? { label: tags[0].name, bg: tags[0].color || 'rgba(243, 68, 13, 0.2)', color: '#FB923C' }
      : null;

  return (
    <Pressable
      onPress={onSelect}
      className="mx-3 mb-1.5 rounded-xl px-3 py-2.5"
      style={[
        { borderWidth: 1 },
        isSelected
          ? { backgroundColor: 'rgba(243, 68, 13, 0.14)', borderColor: 'rgba(243, 68, 13, 0.4)' }
          : isUnread
            ? { backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }
            : { backgroundColor: '#121212', borderColor: '#2A2A2A', opacity: 0.9 },
      ]}
    >
      {/* Top: date (left) + tag/category pill (right) */}
      <View className="flex-row items-center justify-between gap-2 mb-1">
        <Text className="text-gray-500 font-instrument text-xs">
          {formatThreadDateWithTime(thread.last_message_at)}
        </Text>
        {topTag && (
          <View
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: topTag.bg }}
          >
            <Text className="text-xs font-instrument" style={{ color: topTag.color }}>
              {topTag.label}
            </Text>
          </View>
        )}
      </View>

      {/* Bold title: lead name or email fallback */}
      <Text
        className={`text-base mb-1 ${isUnread ? 'font-instrument-bold text-white' : 'font-instrument-semibold text-white'}`}
        numberOfLines={1}
      >
        {cardTitle ?? thread.subject ?? '(No subject)'}
      </Text>

      {/* Message preview */}
      {preview ? (
        <Text
          className="text-gray-400 font-instrument text-sm mb-1.5"
          numberOfLines={2}
        >
          {preview}
        </Text>
      ) : null}

      {/* Campaign chip at bottom */}
      {campaignName ? (
        <View
          className="rounded-lg px-2 py-0.5 self-start"
          style={{ backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' }}
        >
          <Text className="text-xs font-instrument text-gray-400">{campaignName}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
