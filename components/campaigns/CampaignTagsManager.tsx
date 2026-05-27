import { TagsAssignmentPanel } from '@/components/tags';
import {
  createCampaignTag,
  deleteCampaignTag,
  updateCampaignTag,
  type CampaignTag,
} from '@/lib/supabase/services/campaign-tags';
import type { TagLike } from '@/lib/tags/types';
import { useToast } from '@/components/ui/feedback';

export interface CampaignTagsManagerProps {
  accountId: string;
  campaignId: string | null;
  visible: boolean;
  onClose: () => void;
  tags: CampaignTag[];
  accountTags: CampaignTag[];
  onTagCreated: (tag: CampaignTag) => void;
  onAddTag: (campaignId: string, tag: TagLike) => Promise<void>;
  onRemoveTag: (campaignId: string, tag: TagLike) => Promise<void>;
  onUpdateTag: (tag: TagLike) => void;
  onDeleteTag: (tag: TagLike) => void;
}

export function CampaignTagsManager({
  accountId,
  campaignId,
  visible,
  onClose,
  tags,
  accountTags,
  onTagCreated,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
}: CampaignTagsManagerProps) {
  const { toast } = useToast();

  if (!campaignId) return null;

  return (
    <TagsAssignmentPanel
      visible={visible}
      onClose={onClose}
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
  );
}
