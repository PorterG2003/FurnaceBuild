import { View, Text, Pressable } from 'react-native';
import { NoSymbolIcon, PlusIcon } from 'react-native-heroicons/outline';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

/** Sticky header: subject, then prospect(s) vs sender with clear separation */
export function MessagePanelHeader({
  subject,
  prospectEmails,
  senderEmails,
  blockedEmails = [],
  onBlock,
  showBlockButton = true,
  threadTags = [],
  accountTags = [],
  onAddTag,
  onRemoveTag,
  onCreateTag,
  category,
  onSetCategory,
  categoryOptions = ['Lead replied', 'Meeting set', 'Not interested', 'Follow up'],
}: {
  subject: string;
  prospectEmails: string[];
  senderEmails: string[];
  blockedEmails?: string[] | Set<string>;
  onBlock?: () => void;
  showBlockButton?: boolean;
  threadTags?: ThreadTag[];
  accountTags?: ThreadTag[];
  onAddTag?: (tag: ThreadTag) => void;
  onRemoveTag?: (tag: ThreadTag) => void;
  onCreateTag?: () => void;
  category?: string | null;
  onSetCategory?: (category: string | null) => void;
  categoryOptions?: string[];
}) {
  const blockedSet = blockedEmails instanceof Set ? blockedEmails : new Set(blockedEmails);
  const hasBlocked = prospectEmails.some((e) => blockedSet.has(e.trim().toLowerCase()));
  const hasProspects = prospectEmails.length > 0;

  return (
    <View
      className="px-5 py-4 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <Text
        className="text-xl font-instrument-semibold text-white"
        numberOfLines={1}
      >
        {subject || '(No subject)'}
      </Text>
      <View className="mt-3 gap-0">
        {hasProspects && (
          <View className="flex-row items-start gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Prospect{prospectEmails.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View className="flex-1 gap-1">
              {prospectEmails.map((email) => {
                const isBlocked = blockedSet.has(email.trim().toLowerCase());
                return (
                  <View key={email} className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-gray-300 font-instrument text-sm" numberOfLines={1}>
                      {email}
                    </Text>
                    {isBlocked && (
                      <View className="flex-row items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5">
                        <NoSymbolIcon size={12} color="#F59E0B" />
                        <Text className="text-amber-400 font-instrument-medium text-xs">Blocked</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
            {showBlockButton && onBlock && (
              <Pressable
                onPress={onBlock}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#3A3A3A] bg-[#2A2A2A]"
              >
                <NoSymbolIcon size={14} color="#9CA3AF" />
                <Text className="text-gray-400 font-instrument-medium text-xs">Block</Text>
              </Pressable>
            )}
          </View>
        )}
        {hasBlocked && (
          <Text className="text-gray-500 font-instrument text-xs mt-1.5">
            No automated emails will be sent to blocked addresses. Manual replies allowed.
          </Text>
        )}
        {senderEmails.length > 0 && (
          <View className="flex-row items-center gap-3 py-1.5">
            <View className="rounded-md bg-[#1A1A1A] px-2 py-0.5 self-start">
              <Text className="text-gray-500 font-instrument-medium text-xs">
                Your email
              </Text>
            </View>
            <Text className="text-gray-300 font-instrument text-sm flex-1" numberOfLines={2}>
              {senderEmails.join(', ')}
            </Text>
          </View>
        )}
        {onSetCategory && categoryOptions.length > 0 && (
          <View className="flex-row items-center gap-2 py-1.5 flex-wrap">
            <Text className="text-gray-500 font-instrument-medium text-xs">Category:</Text>
            {category ? (
              <View className="flex-row items-center gap-1">
                <View className="rounded px-2 py-0.5" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
                  <Text className="text-xs font-instrument text-indigo-400">{category}</Text>
                </View>
                <Pressable onPress={() => onSetCategory(null)} className="px-1">
                  <Text className="text-xs text-gray-500">×</Text>
                </Pressable>
              </View>
            ) : null}
            {categoryOptions
              .filter((c) => c !== category)
              .map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onSetCategory(c)}
                  className="rounded px-2 py-0.5 border border-[#3A3A3A]"
                >
                  <Text className="text-xs font-instrument text-gray-400">+ {c}</Text>
                </Pressable>
              ))}
          </View>
        )}
        {!hasProspects && senderEmails.length === 0 && (
          <Text className="text-gray-500 font-instrument text-sm py-2">—</Text>
        )}
        {((onAddTag || onRemoveTag || onCreateTag) && (threadTags.length > 0 || accountTags.length > 0 || onCreateTag)) && (
          <View className="flex-row items-center gap-2 py-1.5 flex-wrap">
            {threadTags.map((tag) => (
              <Pressable
                key={tag.id}
                onPress={() => onRemoveTag?.(tag)}
                className="rounded px-2 py-0.5 flex-row items-center gap-1"
                style={{ backgroundColor: tag.color || 'rgba(243, 68, 13, 0.2)' }}
              >
                <Text className="text-xs font-instrument text-orange-400">{tag.name}</Text>
                <Text className="text-xs text-orange-400">×</Text>
              </Pressable>
            ))}
              {accountTags
              .filter((t) => !threadTags.some((tt) => tt.id === t.id))
              .map((tag) => (
                <Pressable
                  key={tag.id}
                  onPress={() => onAddTag?.(tag)}
                  className="rounded px-2 py-0.5 flex-row items-center gap-1 border border-[#3A3A3A]"
                >
                  <PlusIcon size={12} color="#9CA3AF" />
                  <Text className="text-xs font-instrument text-gray-400">{tag.name}</Text>
                </Pressable>
              ))}
            {onCreateTag && (
              <Pressable
                onPress={onCreateTag}
                className="rounded px-2 py-0.5 flex-row items-center gap-1 border border-dashed border-[#4B5563]"
              >
                <PlusIcon size={12} color="#6B7280" />
                <Text className="text-xs font-instrument text-gray-500">New tag</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
