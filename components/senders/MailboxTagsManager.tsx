import { TagsAssignmentPanel } from '@/components/tags';
import { useToast } from '@/components/ui/feedback';
import {
  createMailboxTag,
  deleteMailboxTag,
  updateMailboxTag,
  type MailboxTag,
} from '@/lib/supabase/services/mailbox-tags';
import type { TagLike } from '@/lib/tags/types';

export interface MailboxTagsManagerProps {
  accountId: string;
  mailboxId: string | null;
  visible: boolean;
  onClose: () => void;
  tags: MailboxTag[];
  accountTags: MailboxTag[];
  onTagCreated: (tag: MailboxTag) => void;
  onAddTag: (mailboxId: string, tag: TagLike) => Promise<void>;
  onRemoveTag: (mailboxId: string, tag: TagLike) => Promise<void>;
  onUpdateTag: (tag: TagLike) => void;
  onDeleteTag: (tag: TagLike) => void;
}

export function MailboxTagsManager({
  accountId,
  mailboxId,
  visible,
  onClose,
  tags,
  accountTags,
  onTagCreated,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onDeleteTag,
}: MailboxTagsManagerProps) {
  const { toast } = useToast();

  if (!mailboxId) return null;

  return (
    <TagsAssignmentPanel
      visible={visible}
      onClose={onClose}
      entityLabel="mailbox"
      assignedTags={tags}
      accountTags={accountTags}
      onAddTag={(tag) => {
        void onAddTag(mailboxId, tag).catch((error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to add tag');
        });
      }}
      onRemoveTag={(tag) => {
        void onRemoveTag(mailboxId, tag).catch((error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
        });
      }}
      onUpdateTag={onUpdateTag}
      onDeleteTag={onDeleteTag}
      onCreate={({ name, color }) => createMailboxTag(accountId, { name, color })}
      onCreated={(tag) => {
        onTagCreated(tag as MailboxTag);
        void onAddTag(mailboxId, tag).catch((error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to assign new tag');
        });
      }}
      onUpdate={(tagId, params) => updateMailboxTag(tagId, params)}
      onDelete={(tagId) => deleteMailboxTag(tagId).then(() => undefined)}
    />
  );
}
