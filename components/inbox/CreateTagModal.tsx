import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
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
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(() => pickRandomPresetColor());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setSelectedColor(pickRandomPresetColor());
    }
  }, [visible]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const { createThreadTag } = await import('@/lib/supabase/services/thread-tags');
      const tag = await createThreadTag(accountId, { name: trimmed, color: selectedColor });
      onCreated(tag);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create tag');
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
        <ModalFooter>
          <Pressable
            onPress={onClose}
            disabled={isSubmitting}
            className="px-4 py-3 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
            style={{ opacity: isSubmitting ? 0.5 : 1 }}
          >
            <Text className="text-white font-instrument-medium">Cancel</Text>
          </Pressable>
          <Button
            variant="default"
            onPress={handleCreate}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button
            variant="default"
            onPress={handleCreate}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="text-base font-instrument-medium text-white mb-1">Tag name</Text>
          <Text className="text-sm font-instrument text-gray-400 mb-2">
            This will appear on threads and in filters.
          </Text>
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
      </View>
    </BaseModal>
  );
}
