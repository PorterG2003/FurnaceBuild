import { TagsAssignmentPanel } from '@/components/tags';
import { createThreadTag, updateThreadTag, deleteThreadTag } from '@/lib/supabase/services/thread-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export interface TagsPanelModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  threadTags: ThreadTag[];
  accountTags: ThreadTag[];
  onAddTag: (tag: ThreadTag) => void;
  onRemoveTag: (tag: ThreadTag) => void;
  onUpdateTag?: (tag: ThreadTag) => void;
  onDeleteTag?: (tag: ThreadTag) => void;
  onTagCreated: (tag: ThreadTag) => void;
}

export function TagsPanelModal({
  visible,
  onClose,
  accountId,
  threadTags,
  accountTags,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
  onTagCreated,
}: TagsPanelModalProps) {
  return (
    <TagsAssignmentPanel
      visible={visible}
      onClose={onClose}
      entityLabel="thread"
      assignedTags={threadTags}
      accountTags={accountTags}
      onAddTag={onAddTag}
      onRemoveTag={onRemoveTag}
      onUpdateTag={onUpdateTag}
      onDeleteTag={onDeleteTag}
      onCreate={({ name, color }) => createThreadTag(accountId, { name, color })}
      onCreated={onTagCreated}
      onUpdate={(tagId, params) => updateThreadTag(tagId, params)}
      onDelete={(tagId) => deleteThreadTag(tagId).then(() => undefined)}
    />
  );
}
