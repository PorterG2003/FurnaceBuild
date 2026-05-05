import { View, Pressable, Text, Image, Platform } from 'react-native';
import type { EmailThread } from '@/lib/supabase/types';
import { formatThreadDateWithTime } from '@/lib/inbox';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import { hexToPillBackground, isPresetColor } from '@/lib/inbox/tag-colors';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

const MAX_VISIBLE_TAGS = 3;
const BOTTOM_BADGE_MAX_WIDTH = 180;
const SMARTLEAD_BADGE_SOURCE =
  Platform.OS === 'web'
    ? { uri: '/smartlead_logo.png' }
    : require('../../public/smartlead_logo.png');

export function ThreadItem({
  thread,
  isSelected,
  onSelect,
  isUnread = false,
  cardTitle,
  campaignName = null,
  sourceLabel = null,
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
  sourceLabel?: string | null;
  preview?: string | null;
  tags?: ThreadTag[];
}) {
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const extraCount = tags.length > MAX_VISIBLE_TAGS ? tags.length - MAX_VISIBLE_TAGS : 0;
  const hasCategory = !!thread.category;
  const isSmartleadSource = sourceLabel === 'Smartlead';

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
      {/* Top: date (left) + category/tag pills (right) */}
      <View className="flex-row items-center justify-between gap-2 mb-1">
        <Text className="text-gray-500 font-instrument text-xs">
          {formatThreadDateWithTime(thread.last_message_at)}
        </Text>
        <View className="flex-row items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {hasCategory && (() => {
            const color = getCategoryColor(thread.category);
            const bg = color ? hexToPillBackground(color, 0.15) : 'rgba(148, 163, 184, 0.15)';
            const textColor = color ?? '#94A3B8';
            const borderColor = color ? `${color}50` : '#3A3A3A'; // 8-digit hex for tinted border
            return (
              <View
                className="rounded-lg px-2 py-0.5 border"
                style={{ backgroundColor: bg, borderColor }}
              >
                <Text className="text-xs font-instrument" style={{ color: textColor }}>
                  {thread.category}
                </Text>
              </View>
            );
          })()}
          {thread.out_of_office ? (
            <View
              className="rounded-lg px-2 py-0.5 border"
              style={{
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                borderColor: 'rgba(234, 179, 8, 0.35)',
              }}
            >
              <Text className="text-xs font-instrument" style={{ color: '#FACC15' }}>
                OOO
              </Text>
            </View>
          ) : null}
          {visibleTags.map((tag) => {
            const bg = isPresetColor(tag.color) ? hexToPillBackground(tag.color!) : 'rgba(243, 68, 13, 0.2)';
            return (
              <View
                key={tag.id}
                className="rounded-full px-2 py-0.5"
                style={{ backgroundColor: bg }}
              >
                <Text className="text-xs font-instrument text-white" numberOfLines={1}>
                  {tag.name}
                </Text>
              </View>
            );
          })}
          {extraCount > 0 && (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' }}
            >
              <Text className="text-xs font-instrument text-gray-400">+{extraCount}</Text>
            </View>
          )}
        </View>
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

      {/* Source / campaign chips at bottom */}
      {(sourceLabel || campaignName) ? (
        <View className="flex-row items-center gap-1.5 self-start flex-wrap">
          {sourceLabel ? (
            isSmartleadSource ? (
              <Image
                source={SMARTLEAD_BADGE_SOURCE}
                style={{ width: 20, height: 20, borderRadius: 6 }}
                resizeMode="cover"
                accessibilityLabel="Smartlead"
              />
            ) : (
              <View
                className="rounded-lg px-2 py-0.5 items-center justify-center"
                style={{
                  backgroundColor: 'rgba(243, 68, 13, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(243, 68, 13, 0.3)',
                  maxWidth: BOTTOM_BADGE_MAX_WIDTH,
                }}
              >
                <Text
                  className="text-xs font-instrument"
                  style={{ color: '#F97316' }}
                  numberOfLines={1}
                >
                  {sourceLabel}
                </Text>
              </View>
            )
          ) : null}
          {campaignName ? (
            <View
              className="rounded-lg px-2 py-0.5"
              style={{
                backgroundColor: '#2A2A2A',
                borderWidth: 1,
                borderColor: '#3A3A3A',
                maxWidth: BOTTOM_BADGE_MAX_WIDTH,
              }}
            >
              <Text className="text-xs font-instrument text-gray-400" numberOfLines={1}>
                {campaignName}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
