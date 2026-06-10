import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { PlusIcon, XMarkIcon } from 'react-native-heroicons/outline';
import { BaseModal, ConfirmDeleteModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { CreateTagForm } from './CreateTagForm';
import { EditTagForm } from './EditTagForm';
import { tagChipContainerStyle } from './TagChip';
import type { TagLike } from '@/lib/tags/types';
import { TAG_PRESET_COLORS, pickRandomPresetColor, resolveTagColor } from '@/lib/tags/tag-colors';
import { findTagByName, getTagDuplicateNameMessage } from '@/lib/tags/errors';

const CHIP_GAP = 8;
const DOT_SIZE = 10;

type TagsScreen = 'list' | 'create' | 'edit';

function dotStyle(tag: TagLike) {
  return {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: resolveTagColor(tag.color),
  };
}

const labelStyle = { color: '#FFFFFF' as const, fontSize: 12 };

export interface TagsAssignmentPanelProps {
  visible: boolean;
  onClose: () => void;
  entityLabel: string;
  assignedTags: TagLike[];
  accountTags: TagLike[];
  onAddTag: (tag: TagLike) => void;
  onRemoveTag: (tag: TagLike) => void;
  onUpdateTag?: (tag: TagLike) => void;
  onDeleteTag?: (tag: TagLike) => void;
  onCreate: (params: { name: string; color: string }) => Promise<TagLike>;
  onCreated?: (tag: TagLike) => void;
  onUpdate: (tagId: string, params: { name: string; color: string }) => Promise<TagLike>;
  onDelete: (tagId: string) => Promise<void>;
}

export function TagsAssignmentPanel({
  visible,
  onClose,
  entityLabel,
  assignedTags,
  accountTags,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
  onCreate,
  onCreated,
  onUpdate,
  onDelete,
}: TagsAssignmentPanelProps) {
  const { toast } = useToast();
  const [screen, setScreen] = useState<TagsScreen>('list');
  const [editingTag, setEditingTag] = useState<TagLike | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(() => pickRandomPresetColor());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const goToList = useCallback(() => {
    setScreen('list');
    setEditingTag(null);
    setShowDeleteConfirm(false);
  }, []);

  const goToCreate = useCallback(() => {
    setName('');
    setSelectedColor(pickRandomPresetColor());
    setEditingTag(null);
    setScreen('create');
  }, []);

  const goToEdit = useCallback((tag: TagLike) => {
    setEditingTag(tag);
    setName(tag.name);
    setSelectedColor(tag.color ?? TAG_PRESET_COLORS[0]);
    setScreen('edit');
  }, []);

  useEffect(() => {
    if (!visible) {
      setScreen('list');
      setEditingTag(null);
      setSearch('');
      setName('');
      setSelectedColor(pickRandomPresetColor());
      setShowDeleteConfirm(false);
      setIsSubmitting(false);
      setIsDeleting(false);
    }
  }, [visible]);

  const unassignedTags = accountTags
    .filter((t) => !assignedTags.some((at) => at.id === t.id))
    .filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter a tag name.');
      return;
    }
    if (findTagByName(accountTags, trimmed)) {
      toast.error(getTagDuplicateNameMessage(trimmed));
      return;
    }
    setIsSubmitting(true);
    try {
      const tag = await onCreate({ name: trimmed, color: selectedColor });
      onCreated?.(tag);
      goToList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create tag. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSave = async () => {
    if (!editingTag) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter a tag name.');
      return;
    }
    if (findTagByName(accountTags, trimmed, editingTag.id)) {
      toast.error(getTagDuplicateNameMessage(trimmed));
      return;
    }
    setIsSubmitting(true);
    try {
      const updated = await onUpdate(editingTag.id, { name: trimmed, color: selectedColor });
      onUpdateTag?.(updated);
      goToList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save tag changes. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTag) return;
    setIsDeleting(true);
    try {
      await onDelete(editingTag.id);
      onDeleteTag?.(editingTag);
      setShowDeleteConfirm(false);
      goToList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete tag. Try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const modalTitle =
    screen === 'create' ? 'Create tag' : screen === 'edit' ? 'Edit tag' : 'Tags';
  const modalDescription =
    screen === 'create'
      ? 'Give the tag a name and choose a color.'
      : screen === 'edit'
        ? 'Change the tag name or color.'
        : undefined;

  const listFooter = (
    <ModalFooter>
      <Button variant="default" onPress={goToCreate}>
        Create tag
      </Button>
    </ModalFooter>
  );

  const footer =
    screen === 'create' ? (
      <ModalFooter>
        <Pressable
          onPress={goToList}
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
    ) : screen === 'edit' ? (
      <ModalFooter>
        <Pressable
          onPress={goToList}
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
    ) : (
      listFooter
    );

  const footerMobile =
    screen === 'create' ? (
      <ModalFooter>
        <Button variant="default" onPress={handleCreate} disabled={!name.trim() || isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
      </ModalFooter>
    ) : screen === 'edit' ? (
      <ModalFooter>
        <Button variant="default" onPress={handleSave} disabled={!name.trim() || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    ) : (
      listFooter
    );

  if (!visible) return null;

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={onClose}
        onBack={screen !== 'list' ? goToList : undefined}
        title={modalTitle}
        description={modalDescription}
        maxWidth="lg"
        maxHeight={520}
        footer={footer}
        footerMobile={footerMobile}
      >
        {screen === 'create' ? (
          <CreateTagForm
            entityLabel={entityLabel}
            name={name}
            onNameChange={setName}
            selectedColor={selectedColor}
            onColorChange={setSelectedColor}
            disabled={isSubmitting}
            autoFocus
          />
        ) : screen === 'edit' ? (
          <EditTagForm
            entityLabel={entityLabel}
            name={name}
            onNameChange={setName}
            selectedColor={selectedColor}
            onColorChange={setSelectedColor}
            onDeletePress={() => setShowDeleteConfirm(true)}
            disabled={isSubmitting}
            autoFocus
          />
        ) : (
          <View style={{ paddingBottom: 24 }}>
            <View className="mb-6">
              <Text className="text-sm font-instrument-medium text-gray-400 mb-3">
                On this {entityLabel}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP }}>
                {assignedTags.length === 0 ? (
                  <Text className="text-sm font-instrument text-gray-500">No tags yet</Text>
                ) : (
                  assignedTags.map((tag) => (
                    <View key={tag.id} style={tagChipContainerStyle(tag)}>
                      <Pressable
                        onPress={() => goToEdit(tag)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP }}
                      >
                        <View style={dotStyle(tag)} />
                        <Text style={labelStyle} numberOfLines={1}>
                          {tag.name}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onRemoveTag(tag)}
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

            <View className="mb-6">
              <Text className="text-sm font-instrument-medium text-gray-400 mb-3">Add tag</Text>
              {accountTags.length === 0 ? (
                <Text className="text-sm font-instrument text-gray-500">
                  No other tags yet. Use Create tag below to add one.
                </Text>
              ) : (
                <>
                  {unassignedTags.length > 5 ? (
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search tags…"
                      placeholderTextColor="#6B7280"
                      className="rounded-xl border border-[#3A3A3A] bg-[#121212] px-4 py-3 text-sm text-white mb-3"
                      style={{ borderWidth: 1 }}
                    />
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP }}>
                    {unassignedTags.map((tag) => (
                      <Pressable
                        key={tag.id}
                        onPress={() => onAddTag(tag)}
                        style={tagChipContainerStyle(tag)}
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
          </View>
        )}
      </BaseModal>

      <ConfirmDeleteModal
        visible={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete tag"
        itemName={editingTag?.name ?? ''}
        isLoading={isDeleting}
      />
    </>
  );
}
