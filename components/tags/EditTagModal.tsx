import { useState, useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { BaseModal, ConfirmDeleteModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { TAG_PRESET_COLORS } from '@/lib/tags/tag-colors';
import type { TagLike } from '@/lib/tags/types';
import { EditTagForm } from './EditTagForm';

export interface EditTagModalProps {
  visible: boolean;
  onClose: () => void;
  tag: TagLike | null;
  onSaved: (tag: TagLike) => void;
  onDeleted: (tag: TagLike) => void;
  onUpdate: (tagId: string, params: { name: string; color: string }) => Promise<TagLike>;
  onDelete: (tagId: string) => Promise<void>;
  entityLabel?: string;
}

export function EditTagModal({
  visible,
  onClose,
  tag,
  onSaved,
  onDeleted,
  onUpdate,
  onDelete,
  entityLabel = 'threads',
}: EditTagModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (visible && tag) {
      setName(tag.name);
      setSelectedColor(tag.color ?? TAG_PRESET_COLORS[0]);
    }
  }, [visible, tag]);

  const effectiveColor = selectedColor ?? (tag?.color ?? TAG_PRESET_COLORS[0]);

  const handleSave = async () => {
    if (!tag) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter a tag name.');
      return;
    }
    setIsSubmitting(true);
    try {
      const updated = await onUpdate(tag.id, { name: trimmed, color: effectiveColor });
      onSaved(updated);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save tag changes. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!tag) return;
    setIsDeleting(true);
    try {
      await onDelete(tag.id);
      onDeleted(tag);
      setShowDeleteConfirm(false);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete tag. Try again.");
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
          <ModalFooter>
            <Pressable
              onPress={onClose}
              disabled={isSubmitting}
              className="px-4 py-3 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
              style={{ opacity: isSubmitting ? 0.5 : 1 }}
            >
              <Text className="text-white font-instrument-medium">Cancel</Text>
            </Pressable>
            <Button variant="default" onPress={handleSave} disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </ModalFooter>
        }
        footerMobile={
          <ModalFooter>
            <Button variant="default" onPress={handleSave} disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </ModalFooter>
        }
      >
        <EditTagForm
          entityLabel={entityLabel}
          name={name}
          onNameChange={setName}
          selectedColor={effectiveColor}
          onColorChange={setSelectedColor}
          onDeletePress={() => setShowDeleteConfirm(true)}
          disabled={isSubmitting}
          autoFocus={visible}
        />
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
