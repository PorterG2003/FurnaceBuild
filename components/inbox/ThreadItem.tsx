import type { RefObject } from 'react';
import { View, Pressable, Text } from 'react-native';
import { SmartleadBadge } from '@/components/campaigns';
import type { EmailThread } from '@/lib/supabase/types';
import { formatThreadDateWithTime, hexToPillBackground } from '@/lib/inbox';
import { getCategoryColor } from '@/lib/inbox/category-colors';
import { TagChipRow } from '@/components/tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { OpenConversationIndicator } from './OpenConversationIndicator';

const MAX_VISIBLE_TAGS = 3;
const BOTTOM_BADGE_MAX_WIDTH = 180;
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
  onboardingRef,
  openIndicatorRef,
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
  onboardingRef?: RefObject<View | null>;
  openIndicatorRef?: RefObject<View | null>;
}) {
  const hasCategory = !!thread.category;
  const isSmartleadSource = sourceLabel === 'Smartlead';
  const isOpenConversation = thread.conversation_status === 'open';
  return (
    <Pressable
      ref={onboardingRef}
      collapsable={false}
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
        </View>
      </View>

      {/* Bold title: lead name or email fallback */}
      <View className="mb-1 flex-row items-center gap-2">
        {isOpenConversation ? (
          <View ref={openIndicatorRef} collapsable={false}>
            <OpenConversationIndicator />
          </View>
        ) : null}
        <Text
          className={`flex-1 text-base ${isUnread ? 'font-instrument-bold text-white' : 'font-instrument-semibold text-white'}`}
          numberOfLines={1}
        >
          {cardTitle ?? thread.subject ?? '(No subject)'}
        </Text>
      </View>

      {/* Message preview */}
      {preview ? (
        <Text
          className="text-gray-400 font-instrument text-sm mb-1.5"
          numberOfLines={2}
        >
          {preview}
        </Text>
      ) : null}

      {/* Source / campaign, then tags on the row below */}
      {sourceLabel || campaignName || tags.length > 0 ? (
        <View className="self-start gap-1.5 mt-0.5">
          {sourceLabel || campaignName ? (
            <View className="flex-row items-center gap-1.5 flex-wrap">
              {sourceLabel ? (
                isSmartleadSource ? (
                  <SmartleadBadge />
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
          {tags.length > 0 ? <TagChipRow tags={tags} maxVisible={MAX_VISIBLE_TAGS} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
