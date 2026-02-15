import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { PlusIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { EditTagModal } from '@/components/inbox/EditTagModal';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { hexToPillBackground, resolveTagColor, isPresetColor } from '@/lib/inbox/tag-colors';

const CHIP_BORDER_RADIUS = 8;
const CHIP_PADDING_H = 8;
const CHIP_PADDING_V = 8;
const CHIP_GAP = 8;
const DOT_SIZE = 10;

const chipContainerStyle = (tag: ThreadTag) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  backgroundColor: isPresetColor(tag.color) ? hexToPillBackground(tag.color!) : 'rgba(243, 68, 13, 0.2)',
  borderWidth: 1,
  borderColor: resolveTagColor(tag.color),
  borderRadius: CHIP_BORDER_RADIUS,
  paddingHorizontal: CHIP_PADDING_H,
  paddingVertical: CHIP_PADDING_V,
  gap: CHIP_GAP,
});

const dotStyle = (tag: ThreadTag) => ({
  width: DOT_SIZE,
  height: DOT_SIZE,
  borderRadius: DOT_SIZE / 2,
  backgroundColor: resolveTagColor(tag.color),
});

const labelStyle = { color: '#FFFFFF' as const, fontSize: 12 };

export interface TagsPanelModalProps {
  visible: boolean;
  onClose: () => void;
  threadTags: ThreadTag[];
  accountTags: ThreadTag[];
  onAddTag: (tag: ThreadTag) => void;
  onRemoveTag: (tag: ThreadTag) => void;
  onUpdateTag?: (tag: ThreadTag) => void;
  onDeleteTag?: (tag: ThreadTag) => void;
  onCreateTag: () => void;
}

export function TagsPanelModal({
  visible,
  onClose,
  threadTags,
  accountTags,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
  onCreateTag,
}: TagsPanelModalProps) {
  const [editingTag, setEditingTag] = useState<ThreadTag | null>(null);
  const [search, setSearch] = useState('');

  const unassignedTags = accountTags
    .filter((t) => !threadTags.some((tt) => tt.id === t.id))
    .filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));

  if (!visible) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Tags"
      maxWidth="lg"
      maxHeight={520}
    >
      <View style={{ paddingBottom: 24 }}>
        {/* On this thread */}
        <View className="mb-6">
          <Text className="text-sm font-instrument-medium text-gray-400 mb-3">On this thread</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP }}>
            {threadTags.length === 0 ? (
              <Text className="text-sm font-instrument text-gray-500">No tags yet</Text>
            ) : (
              threadTags.map((tag) => (
                <View key={tag.id} style={chipContainerStyle(tag)}>
                  <Pressable
                    onPress={() => setEditingTag(tag)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP }}
                  >
                    <View style={dotStyle(tag)} />
                    <Text style={labelStyle} numberOfLines={1}>
                      {tag.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onRemoveTag(tag);
                    }}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <XMarkIcon size={14} color="#9CA3AF" />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Add tag */}
        <View className="mb-6">
          <Text className="text-sm font-instrument-medium text-gray-400 mb-3">Add tag</Text>
          {accountTags.length === 0 ? (
            <Text className="text-sm font-instrument text-gray-500">No other tags. Create one below.</Text>
          ) : (
            <>
              {unassignedTags.length > 5 && (
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search tags…"
                  placeholderTextColor="#6B7280"
                  className="rounded-xl border border-[#3A3A3A] bg-[#121212] px-4 py-3 text-sm text-white mb-3"
                  style={{ borderWidth: 1 }}
                />
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP }}>
                {unassignedTags.map((tag) => (
                  <Pressable
                    key={tag.id}
                    onPress={() => onAddTag(tag)}
                    style={chipContainerStyle(tag)}
                  >
                    <View style={dotStyle(tag)} />
                    <Text style={labelStyle} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <PlusIcon size={14} color="#FFFFFF" />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Create tag */}
        <View>
          <Button
            variant="default"
            onPress={() => {
              onClose();
              onCreateTag();
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14 }}>Create tag</Text>
          </Button>
        </View>
      </View>

      <EditTagModal
        visible={editingTag !== null}
        onClose={() => setEditingTag(null)}
        tag={editingTag}
        onSaved={(updated) => {
          onUpdateTag?.(updated);
          setEditingTag(null);
        }}
        onDeleted={(deleted) => {
          onDeleteTag?.(deleted);
          setEditingTag(null);
        }}
      />
    </BaseModal>
  );
}
