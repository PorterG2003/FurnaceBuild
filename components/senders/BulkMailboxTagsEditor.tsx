import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CreateTagForm } from '@/components/tags/CreateTagForm';
import { SearchAndSelectMulti } from '@/components/ui/forms/SearchAndSelectMulti';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/feedback';
import { createMailboxTag, type MailboxTag } from '@/lib/supabase/services/mailbox-tags';
import { pickRandomPresetColor, resolveTagColor } from '@/lib/tags/tag-colors';
import { findTagByName, getTagDuplicateNameMessage } from '@/lib/tags/errors';
import type { BulkMailboxTagChanges } from './types';
import { withBulkMailboxAddTagIds, withBulkMailboxRemoveTagIds } from './types';

const TAG_MODE_TABS = [
  { id: 'patch', label: 'Add or remove' },
  { id: 'replace', label: 'Replace all' },
] as const;

export interface BulkMailboxTagsEditorProps {
  accountId: string;
  selectedMailboxCount: number;
  accountTags: MailboxTag[];
  changes: BulkMailboxTagChanges;
  onChange: (changes: BulkMailboxTagChanges) => void;
  onTagCreated: (tag: MailboxTag) => void;
}

export function BulkMailboxTagsEditor({
  accountId,
  selectedMailboxCount,
  accountTags,
  changes,
  onChange,
  onTagCreated,
}: BulkMailboxTagsEditorProps) {
  const { toast } = useToast();
  const [creatingTag, setCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(() => pickRandomPresetColor());
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);

  const mailboxLabel = selectedMailboxCount === 1 ? 'mailbox' : 'mailboxes';

  const handleModeChange = useCallback(
    (tabId: string) => {
      const mode = tabId === 'replace' ? 'replace' : 'patch';
      onChange({ ...changes, mode });
    },
    [changes, onChange],
  );

  const handleCreateTag = async () => {
    const trimmed = newTagName.trim();
    if (!trimmed) {
      toast.error('Enter a tag name.');
      return;
    }
    if (findTagByName(accountTags, trimmed)) {
      toast.error(getTagDuplicateNameMessage(trimmed));
      return;
    }
    setIsSubmittingTag(true);
    try {
      const tag = await createMailboxTag(accountId, { name: trimmed, color: newTagColor });
      onTagCreated(tag);
      if (changes.mode === 'replace') {
        onChange({
          ...changes,
          replaceTagIds: [...changes.replaceTagIds, tag.id],
        });
      } else {
        onChange(withBulkMailboxAddTagIds(changes, [...changes.addTagIds, tag.id]));
      }
      setNewTagName('');
      setNewTagColor(pickRandomPresetColor());
      setCreatingTag(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create tag. Try again.");
    } finally {
      setIsSubmittingTag(false);
    }
  };

  return (
    <View className="gap-4 mt-4">
      <Text className="text-lg font-instrument-semibold text-white">Tags</Text>
      <Text className="text-sm font-instrument text-gray-400 -mt-2">
        Tag changes apply to all {selectedMailboxCount} selected {mailboxLabel}.
      </Text>

      <Tabs
        tabs={[...TAG_MODE_TABS]}
        activeTab={changes.mode}
        onTabChange={handleModeChange}
        layout="equal"
        marginBottom={8}
      />

      {changes.mode === 'replace' ? (
        <>
          <Text className="text-sm font-instrument text-amber-200/90">
            Replace mode sets the exact tag list on each selected mailbox and removes any tags not listed.
          </Text>
          <SearchAndSelectMulti
            items={accountTags}
            getItemId={(tag) => tag.id}
            getItemLabel={(tag) => tag.name}
            getItemColor={(tag) => resolveTagColor(tag.color)}
            value={changes.replaceTagIds}
            onChange={(replaceTagIds) => onChange({ ...changes, replaceTagIds })}
            label="Tags on every selected mailbox"
            searchPlaceholder="Search tags…"
            placeholder="No tags selected"
            emptyMessage={(hasSearch) => (hasSearch ? 'No tags match' : 'No tags yet — create one below')}
            variant="solid"
          />
        </>
      ) : (
        <>
          <SearchAndSelectMulti
            items={accountTags}
            getItemId={(tag) => tag.id}
            getItemLabel={(tag) => tag.name}
            getItemColor={(tag) => resolveTagColor(tag.color)}
            value={changes.addTagIds}
            onChange={(addTagIds) => onChange(withBulkMailboxAddTagIds(changes, addTagIds))}
            label="Tags to add"
            searchPlaceholder="Search tags…"
            placeholder="None selected"
            emptyMessage={(hasSearch) => (hasSearch ? 'No tags match' : 'No tags yet — create one below')}
            variant="solid"
          />
          <SearchAndSelectMulti
            items={accountTags}
            getItemId={(tag) => tag.id}
            getItemLabel={(tag) => tag.name}
            getItemColor={(tag) => resolveTagColor(tag.color)}
            value={changes.removeTagIds}
            onChange={(removeTagIds) => onChange(withBulkMailboxRemoveTagIds(changes, removeTagIds))}
            label="Tags to remove"
            searchPlaceholder="Search tags…"
            placeholder="None selected"
            emptyMessage={(hasSearch) => (hasSearch ? 'No tags match' : 'No tags yet')}
            variant="solid"
          />
        </>
      )}

      {creatingTag ? (
        <View className="gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <CreateTagForm
            entityLabel="mailbox"
            name={newTagName}
            onNameChange={setNewTagName}
            selectedColor={newTagColor}
            onColorChange={setNewTagColor}
            disabled={isSubmittingTag}
            autoFocus
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                setCreatingTag(false);
                setNewTagName('');
                setNewTagColor(pickRandomPresetColor());
              }}
              disabled={isSubmittingTag}
              className="flex-1 px-4 py-3 rounded-xl border border-white/20 bg-white/5 items-center justify-center"
              style={{ opacity: isSubmittingTag ? 0.5 : 1 }}
            >
              <Text className="text-white font-instrument-medium">Cancel</Text>
            </Pressable>
            <Button
              variant="default"
              onPress={handleCreateTag}
              disabled={!newTagName.trim() || isSubmittingTag}
              className="flex-1"
            >
              {isSubmittingTag ? 'Creating…' : 'Create tag'}
            </Button>
          </View>
        </View>
      ) : (
        <Button variant="secondary" size="sm" onPress={() => setCreatingTag(true)}>
          Create tag
        </Button>
      )}
    </View>
  );
}
