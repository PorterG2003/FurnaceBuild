import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { ChevronDownIcon, NoSymbolIcon, PlusIcon } from 'react-native-heroicons/outline';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

/** Sticky header: left = prospect name + email; right = toolbar (tags, campaign, category, Block) */
export function MessagePanelHeader({
  prospectName,
  campaignName,
  prospectEmails,
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
  prospectName?: string | null;
  campaignName?: string | null;
  prospectEmails: string[];
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
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const blockedSet = blockedEmails instanceof Set ? blockedEmails : new Set(blockedEmails);
  const hasBlocked = prospectEmails.some((e) => blockedSet.has(e.trim().toLowerCase()));
  const showTags =
    (onAddTag || onRemoveTag || onCreateTag) &&
    (threadTags.length > 0 || accountTags.length > 0 || onCreateTag);

  const title = prospectName ?? prospectEmails[0] ?? '—';
  const emailLine = prospectEmails.length > 0 ? prospectEmails.join(', ') : '';

  return (
    <View
      className="px-5 py-3.5 border-b border-[#2A2A2A] bg-[#0D0D0D]"
      style={{ borderBottomWidth: 1 }}
    >
      <View className="flex-row items-center justify-between gap-3">
        {/* Left: prospect name + email (tight between, more above/below) */}
        <View className="flex-1 min-w-0">
          <Text
            className="text-lg font-instrument-semibold text-white leading-tight"
            numberOfLines={1}
          >
            {title}
          </Text>
          {emailLine ? (
            <Text
              className="text-sm font-instrument text-gray-500 leading-tight"
              numberOfLines={1}
              style={{ marginTop: 2 }}
            >
              {emailLine}
            </Text>
          ) : null}
          {hasBlocked && (
            <Text className="text-gray-500 font-instrument text-xs mt-1.5">
              No automated emails to blocked.
            </Text>
          )}
        </View>

        {/* Right: toolbar — tags, campaign chip, category, Block */}
        <View className="flex-row items-center gap-2 flex-shrink-0">
          {showTags && (
            <View className="flex-row items-center gap-1.5">
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
          {campaignName ? (
            <View
              className="rounded-lg px-2 py-0.5"
              style={{ backgroundColor: '#2A2A2A', borderWidth: 1, borderColor: '#3A3A3A' }}
            >
              <Text className="text-xs font-instrument text-gray-400" numberOfLines={1}>
                {campaignName}
              </Text>
            </View>
          ) : null}
          {onSetCategory && categoryOptions.length > 0 && (
            <>
              <Pressable
                onPress={() => setCategoryDropdownOpen(true)}
                className="flex-row items-center gap-1.5 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] px-2.5 py-1.5 min-w-[100px]"
              >
                {category ? (
                  <View
                    className="rounded px-1.5 py-0.5 flex-1 min-w-0"
                    style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}
                  >
                    <Text className="text-xs font-instrument text-indigo-400" numberOfLines={1}>
                      {category}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-xs font-instrument text-gray-500 flex-1">Category</Text>
                )}
                <ChevronDownIcon size={14} color="#9CA3AF" />
              </Pressable>
              <Modal
                visible={categoryDropdownOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setCategoryDropdownOpen(false)}
              >
                <Pressable
                  className="flex-1 bg-black/50"
                  onPress={() => setCategoryDropdownOpen(false)}
                >
                  <Pressable
                    className="absolute right-5 top-24 min-w-[180px] max-w-[280px] rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] overflow-hidden"
                    onPress={(e) => e.stopPropagation()}
                  >
                    <ScrollView style={{ maxHeight: 320 }}>
                      <Pressable
                        className="px-3 py-2.5 border-b border-[#2A2A2A]"
                        onPress={() => {
                          onSetCategory(null);
                          setCategoryDropdownOpen(false);
                        }}
                      >
                        <Text className="text-sm font-instrument text-gray-400">No category</Text>
                      </Pressable>
                      {categoryOptions.map((c) => (
                        <Pressable
                          key={c}
                          className="px-3 py-2.5 border-b border-[#2A2A2A] last:border-b-0"
                          onPress={() => {
                            onSetCategory(c);
                            setCategoryDropdownOpen(false);
                          }}
                        >
                          <Text
                            className={`text-sm font-instrument ${c === category ? 'text-indigo-400' : 'text-gray-300'}`}
                          >
                            {c}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </Pressable>
                </Pressable>
              </Modal>
            </>
          )}
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
      </View>
    </View>
  );
}
