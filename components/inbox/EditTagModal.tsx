import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { TrashIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { ConfirmDeleteModal } from '@/components/ui/modals/ConfirmDeleteModal';
import { Button } from '@/components/ui/button';
import { TAG_PRESET_COLORS } from '@/lib/inbox/tag-colors';
import { updateThreadTag, deleteThreadTag } from '@/lib/supabase/services/thread-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export interface EditTagModalProps {
  visible: boolean;
  onClose: () => void;
  tag: ThreadTag | null;
  onSaved: (tag: ThreadTag) => void;
  onDeleted: (tag: ThreadTag) => void;
}

export function EditTagModal({
  visible,
  onClose,
  tag,
  onSaved,
  onDeleted,
}: EditTagModalProps) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (visible && tag) {
      setName(tag.name);
      setSelectedColor(tag.color ?? TAG_PRESET_COLORS[0]);
      setError(null);
    }
  }, [visible, tag]);

  const effectiveColor = selectedColor ?? (tag?.color ?? TAG_PRESET_COLORS[0]);

  const handleSave = async () => {
    if (!tag) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await updateThreadTag(tag.id, {
        name: trimmed,
        color: effectiveColor,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update tag');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!tag) return;
    setIsDeleting(true);
    try {
      await deleteThreadTag(tag.id);
      onDeleted(tag);
      setShowDeleteConfirm(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!tag) return null;

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        title="Edit tag"
        description="Change the tag name or color."
        maxWidth="md"
        footer={
          <View className="flex-row gap-3">
            <Pressable
              onPress={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-3 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
              style={{ opacity: isSubmitting ? 0.5 : 1 }}
            >
              <Text className="text-white font-instrument-medium">Cancel</Text>
            </Pressable>
            <Button
              variant="default"
              onPress={handleSave}
              disabled={!name.trim() || isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <View>
            <View className="flex-row justify-between items-center mb-2">
              <View className="flex-1 mr-3">
                <Text className="text-base font-instrument-medium text-white">Tag name</Text>
                <Text className="text-sm font-instrument text-gray-400 mt-0.5">
                  This will appear on threads and in filters.
                </Text>
              </View>
              <Pressable
                onPress={() => setShowDeleteConfirm(true)}
                disabled={isSubmitting}
                className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/30"
                style={{ opacity: isSubmitting ? 0.5 : 1 }}
              >
                <TrashIcon size={16} color="#F87171" />
                <Text className="text-sm font-instrument-medium text-red-400">Delete tag</Text>
              </Pressable>
            </View>
            <TextInput
              value={name}
              onChangeText={(t) => {
                setName(t);
                setError(null);
              }}
              placeholder="e.g. Follow up"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={visible}
              className="border border-white/30 rounded-xl px-4 py-3.5 bg-white/5 text-base text-white"
              style={{
                borderColor: '#FFFFFF4D',
                backgroundColor: '#FFFFFF0D',
                color: '#FFFFFF',
                borderWidth: 1,
              }}
              selectionColor="#FF4D00"
              underlineColorAndroid="transparent"
              editable={!isSubmitting}
            />
          </View>

          <View>
            <Text className="text-base font-instrument-medium text-white mb-2">Color</Text>
            <View className="flex-row flex-wrap gap-2">
              {TAG_PRESET_COLORS.map((hex) => {
                const isSelected = effectiveColor === hex;
                return (
                  <Pressable
                    key={hex}
                    onPress={() => setSelectedColor(hex)}
                    disabled={isSubmitting}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: hex,
                      borderWidth: isSelected ? 3 : 1,
                      borderColor: isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                    }}
                  />
                );
              })}
            </View>
          </View>

          {error ? (
            <Text className="text-sm font-instrument text-red-400">{error}</Text>
          ) : null}
        </View>
      </BaseModal>

      <ConfirmDeleteModal
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete tag"
        itemName={tag.name}
        isLoading={isDeleting}
      />
    </>
  );
}
