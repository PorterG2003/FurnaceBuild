import { useState, useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { pickRandomPresetColor } from '@/lib/tags/tag-colors';
import type { TagLike } from '@/lib/tags/types';
import { CreateTagForm } from './CreateTagForm';

export interface CreateTagModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (tag: TagLike) => void;
  onCreate: (params: { name: string; color: string }) => Promise<TagLike>;
  entityLabel?: string;
}

export function CreateTagModal({
  visible,
  onClose,
  onCreated,
  onCreate,
  entityLabel = 'threads',
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
      toast.error('Enter a tag name.');
      return;
    }
    setIsSubmitting(true);
    try {
      const tag = await onCreate({ name: trimmed, color: selectedColor });
      onCreated(tag);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create tag. Try again.");
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
          <Button variant="default" onPress={handleCreate} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button variant="default" onPress={handleCreate} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
    >
      <CreateTagForm
        entityLabel={entityLabel}
        name={name}
        onNameChange={setName}
        selectedColor={selectedColor}
        onColorChange={setSelectedColor}
        disabled={isSubmitting}
        autoFocus={visible}
      />
    </BaseModal>
  );
}
