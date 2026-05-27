import { useState } from 'react';
import { View } from 'react-native';
import { PencilIcon } from 'react-native-heroicons/outline';
import { TagChip, TagsAssignmentPanel } from '@/components/tags';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  createCampaignTag,
  deleteCampaignTag,
  updateCampaignTag,
  type CampaignTag,
} from '@/lib/supabase/services/campaign-tags';
import type { TagLike } from '@/lib/tags/types';
import { useToast } from '@/components/ui/feedback';

export interface CampaignTagsSectionProps {
  accountId: string;
  campaignId: string;
  tags: CampaignTag[];
  accountTags: CampaignTag[];
  onTagCreated: (tag: CampaignTag) => void;
  onAddTag: (campaignId: string, tag: TagLike) => Promise<void>;
  onRemoveTag: (campaignId: string, tag: TagLike) => Promise<void>;
  onUpdateTag: (tag: TagLike) => void;
  onDeleteTag: (tag: TagLike) => void;
  showChipRow?: boolean;
}

export function CampaignTagsSection({
  accountId,
  campaignId,
  tags,
  accountTags,
  onTagCreated,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
  showChipRow = true,
}: CampaignTagsSectionProps) {
  const { toast } = useToast();
  const [tagsPanelOpen, setTagsPanelOpen] = useState(false);
  const hasTags = tags.length > 0;
  const openTagsPanel = () => setTagsPanelOpen(true);

  return (
    <>
      <View className="flex-row flex-wrap items-center gap-2">
        {showChipRow && hasTags
          ? tags.map((tag) => <TagChip key={tag.id} tag={tag} variant="default" />)
          : null}
        {hasTags ? (
          <IconButton
            icon={PencilIcon}
            variant="ghost"
            size="sm"
            onPress={openTagsPanel}
            accessibilityLabel="Edit tags"
            hitSlop={8}
            style={{ flexShrink: 0 }}
            className="web:transition-colors web:duration-150 web:hover:bg-white/10 web:active:bg-white/5"
          />
        ) : (
          <Button variant="secondary" size="sm" onPress={openTagsPanel}>
            Add Tags
          </Button>
        )}
      </View>

      <TagsAssignmentPanel
        visible={tagsPanelOpen}
        onClose={() => setTagsPanelOpen(false)}
        entityLabel="campaign"
        assignedTags={tags}
        accountTags={accountTags}
        onAddTag={(tag) => {
          void onAddTag(campaignId, tag).catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Failed to add tag');
          });
        }}
        onRemoveTag={(tag) => {
          void onRemoveTag(campaignId, tag).catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Failed to remove tag');
          });
        }}
        onUpdateTag={onUpdateTag}
        onDeleteTag={onDeleteTag}
        onCreate={({ name, color }) => createCampaignTag(accountId, { name, color })}
        onCreated={(tag) => {
          onTagCreated(tag as CampaignTag);
          void onAddTag(campaignId, tag).catch((e) => {
            toast.error(e instanceof Error ? e.message : 'Failed to assign new tag');
          });
        }}
        onUpdate={(tagId, params) => updateCampaignTag(tagId, params)}
        onDelete={(tagId) => deleteCampaignTag(tagId).then(() => undefined)}
      />
    </>
  );
}
