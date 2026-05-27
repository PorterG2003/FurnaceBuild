import { CreateTagModal as SharedCreateTagModal } from '@/components/tags';
import { createThreadTag } from '@/lib/supabase/services/thread-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export interface CreateTagModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (tag: ThreadTag) => void;
  accountId: string;
}

export function CreateTagModal({ visible, onClose, onCreated, accountId }: CreateTagModalProps) {
  return (
    <SharedCreateTagModal
      visible={visible}
      onClose={onClose}
      onCreated={onCreated}
      entityLabel="threads"
      onCreate={({ name, color }) => createThreadTag(accountId, { name, color })}
    />
  );
}
