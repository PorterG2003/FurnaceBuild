import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput } from 'react-native';
import { PlusIcon, XMarkIcon } from 'react-native-heroicons/outline';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { TAG_PRESET_COLORS, hexToPillBackground, resolveTagColor, isPresetColor } from '@/lib/inbox/tag-colors';

export interface TagsPanelModalProps {
  visible: boolean;
  onClose: () => void;
  threadTags: ThreadTag[];
  accountTags: ThreadTag[];
  onAddTag: (tag: ThreadTag) => void;
  onRemoveTag: (tag: ThreadTag) => void;
  onUpdateTagColor: (tag: ThreadTag, color: string) => void;
  onCreateTag: () => void;
}

export function TagsPanelModal({
  visible,
  onClose,
  threadTags,
  accountTags,
  onAddTag,
  onRemoveTag,
  onUpdateTagColor,
  onCreateTag,
}: TagsPanelModalProps) {
  const [tagEditingColor, setTagEditingColor] = useState<ThreadTag | null>(null);
  const [search, setSearch] = useState('');

  const unassignedTags = accountTags
    .filter((t) => !threadTags.some((tt) => tt.id === t.id))
    .filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <Pressable
          className="absolute right-5 top-24 min-w-[280px] max-w-[360px] max-h-[420px] rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] overflow-hidden"
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {/* Assigned to this thread */}
            <View className="px-3 pt-3 pb-2 border-b border-[#2A2A2A]">
              <Text className="text-xs font-instrument-medium text-gray-400 mb-2">On this thread</Text>
              {threadTags.length === 0 ? (
                <Text className="text-sm font-instrument text-gray-500 py-1">No tags yet</Text>
              ) : (
                threadTags.map((tag) => (
                  <View key={tag.id} className="flex-row items-center gap-2 mb-2">
                    <View className="flex-1 flex-row flex-wrap items-center gap-2">
                      <Pressable
                        onPress={() => setTagEditingColor(tagEditingColor?.id === tag.id ? null : tag)}
                        className="rounded px-2 py-1.5 flex-row items-center gap-1.5 flex-shrink-0"
                        style={{
                          backgroundColor: isPresetColor(tag.color)
                            ? hexToPillBackground(tag.color!)
                            : 'rgba(243, 68, 13, 0.2)',
                          borderWidth: 1,
                          borderColor: resolveTagColor(tag.color),
                        }}
                      >
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: resolveTagColor(tag.color),
                          }}
                        />
                        <Text className="text-xs font-instrument text-white" numberOfLines={1}>
                          {tag.name}
                        </Text>
                      </Pressable>
                      {tagEditingColor?.id === tag.id ? (
                        <View className="flex-row flex-wrap gap-1.5 py-1">
                          {TAG_PRESET_COLORS.map((hex) => (
                            <Pressable
                              key={hex}
                              onPress={() => {
                                onUpdateTagColor(tag, hex);
                                setTagEditingColor(null);
                              }}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 11,
                                backgroundColor: hex,
                                borderWidth: 2,
                                borderColor: tag.color === hex ? '#FFF' : 'transparent',
                              }}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => onRemoveTag(tag)}
                      className="p-1 rounded"
                      hitSlop={8}
                    >
                      <XMarkIcon size={16} color="#9CA3AF" />
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            {/* Add tag */}
            <View className="px-3 py-3 border-b border-[#2A2A2A]">
              <Text className="text-xs font-instrument-medium text-gray-400 mb-2">Add tag</Text>
              {accountTags.length === 0 ? (
                <Text className="text-sm font-instrument text-gray-500 py-1">No other tags. Create one below.</Text>
              ) : (
                <>
                  {unassignedTags.length > 5 && (
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search tags…"
                      placeholderTextColor="#6B7280"
                      className="rounded-lg border border-[#3A3A3A] bg-[#121212] px-3 py-2 text-sm text-white mb-2"
                      style={{ borderWidth: 1 }}
                    />
                  )}
                  <View className="flex-row flex-wrap gap-2">
                    {unassignedTags.map((tag) => (
                      <Pressable
                        key={tag.id}
                        onPress={() => onAddTag(tag)}
                        className="rounded px-2 py-1.5 flex-row items-center gap-1.5 border border-[#3A3A3A]"
                      >
                        <PlusIcon size={12} color="#9CA3AF" />
                        <Text className="text-xs font-instrument text-gray-300">{tag.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>

            {/* Create tag */}
            <View className="px-3 py-3">
              <Pressable
                onPress={() => {
                  onClose();
                  onCreateTag();
                }}
                className="rounded-lg border border-dashed border-[#4B5563] py-2.5 flex-row items-center justify-center gap-2"
              >
                <PlusIcon size={16} color="#6B7280" />
                <Text className="text-sm font-instrument text-gray-500">Create tag</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
