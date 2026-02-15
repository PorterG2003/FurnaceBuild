import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { TAG_PRESET_COLORS, pickRandomPresetColor } from '@/lib/inbox/tag-colors';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export interface CreateTagModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (tag: ThreadTag) => void;
  accountId: string;
}

export function CreateTagModal({
  visible,
  onClose,
  onCreated,
  accountId,
}: CreateTagModalProps) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(() => pickRandomPresetColor());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to random color when modal opens
  useEffect(() => {
    if (visible) {
      setName('');
      setSelectedColor(pickRandomPresetColor());
      setError(null);
    }
  }, [visible]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { createThreadTag } = await import('@/lib/supabase/services/thread-tags');
      const tag = await createThreadTag(accountId, { name: trimmed, color: selectedColor });
      onCreated(tag);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Create tag"
      description="Give the tag a name and choose a color."
      maxWidth="sm"
      footer={
        <View className="flex-row gap-3">
          <Button variant="secondary" onPress={onClose} disabled={isSubmitting} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="default"
            onPress={handleCreate}
            disabled={!name.trim() || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="text-sm font-instrument-medium text-gray-300 mb-2">Name</Text>
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
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
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
          <Text className="text-sm font-instrument-medium text-gray-300 mb-2">Color</Text>
          <View className="flex-row flex-wrap gap-2">
            {TAG_PRESET_COLORS.map((hex) => {
              const isSelected = selectedColor === hex;
              return (
                <Pressable
                  key={hex}
                  onPress={() => setSelectedColor(hex)}
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
  );
}
