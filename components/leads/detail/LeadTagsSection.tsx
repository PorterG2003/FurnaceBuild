import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { PencilIcon } from 'react-native-heroicons/outline';
import { TagChip, TagsAssignmentPanel } from '@/components/tags';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useToast } from '@/components/ui/feedback';
import { groupTagsByName } from '@/lib/tags/groupTags';
import type { TagLike } from '@/lib/tags/types';
import {
  addTagToPerson,
  createLeadTag,
  deleteLeadTag,
  getLeadTags,
  getTagsForPerson,
  removeTagFromPerson,
  updateLeadTag,
  type LeadTag,
} from '@/lib/supabase/services/lead-tags';

function toTagLike(tag: LeadTag): TagLike {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    groupName: tag.group_name,
    isCatalog: tag.is_catalog,
  };
}

export function LeadTagsSection({
  accountId,
  globalLeadId,
}: {
  accountId: string;
  globalLeadId: string;
}) {
  const { toast } = useToast();
  const [tagsPanelOpen, setTagsPanelOpen] = useState(false);
  const [assigned, setAssigned] = useState<LeadTag[]>([]);
  const [accountTags, setAccountTags] = useState<LeadTag[]>([]);

  const load = useCallback(async () => {
    const [nextAssigned, nextAccount] = await Promise.all([
      getTagsForPerson(accountId, globalLeadId),
      getLeadTags(accountId),
    ]);
    setAssigned(nextAssigned);
    setAccountTags(nextAccount);
  }, [accountId, globalLeadId]);

  useEffect(() => {
    void load().catch((e) => {
      toast.error(e instanceof Error ? e.message : 'Failed to load lead tags');
    });
  }, [load, toast]);

  const assignedLike = useMemo(() => assigned.map(toTagLike), [assigned]);
  const accountLike = useMemo(() => accountTags.map(toTagLike), [accountTags]);
  const groupedAssigned = useMemo(() => groupTagsByName(assignedLike), [assignedLike]);
  const hasTags = assigned.length > 0;

  const handleAdd = async (tag: TagLike) => {
    await addTagToPerson(accountId, globalLeadId, tag.id);
    await load();
  };

  const handleRemove = async (tag: TagLike) => {
    await removeTagFromPerson(accountId, globalLeadId, tag.id);
    await load();
  };

  return (
    <>
      <View className="flex-row flex-wrap items-center gap-2">
        {hasTags
          ? groupedAssigned.flatMap((bucket) =>
              bucket.tags.map((tag) => <TagChip key={tag.id} tag={tag} variant="default" />),
            )
          : null}
        {hasTags ? (
          <IconButton
            icon={PencilIcon}
            variant="ghost"
            size="sm"
            onPress={() => setTagsPanelOpen(true)}
            accessibilityLabel="Edit tags"
            hitSlop={8}
            style={{ flexShrink: 0 }}
            className="web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5"
          />
        ) : (
          <Button variant="secondary" size="sm" onPress={() => setTagsPanelOpen(true)}>
            Add Tags
          </Button>
        )}
      </View>

      <TagsAssignmentPanel
        visible={tagsPanelOpen}
        onClose={() => setTagsPanelOpen(false)}
        entityLabel="person"
        assignedTags={assignedLike}
        accountTags={accountLike}
        canEditTag={(tag) => !tag.isCatalog}
        onAddTag={(tag) => {
          void handleAdd(tag).catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Failed to add tag');
          });
        }}
        onRemoveTag={(tag) => {
          void handleRemove(tag).catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Failed to remove tag');
          });
        }}
        onUpdateTag={() => {
          void load();
        }}
        onDeleteTag={() => {
          void load();
        }}
        onCreate={({ name, color }) => createLeadTag(accountId, { name, color })}
        onCreated={(tag) => {
          void handleAdd(tag);
        }}
        onUpdate={(tagId, params) => updateLeadTag(tagId, params)}
        onDelete={(tagId) => deleteLeadTag(tagId)}
      />
    </>
  );
}
