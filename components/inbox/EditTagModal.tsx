import { EditTagModal as SharedEditTagModal } from '@/components/tags';
import { updateThreadTag, deleteThreadTag } from '@/lib/supabase/services/thread-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';

export interface EditTagModalProps {
  visible: boolean;
  onClose: () => void;
  tag: ThreadTag | null;
  onSaved: (tag: ThreadTag) => void;
  onDeleted: (tag: ThreadTag) => void;
}

export function EditTagModal({ visible, onClose, tag, onSaved, onDeleted }: EditTagModalProps) {
  return (
    <SharedEditTagModal
      visible={visible}
      onClose={onClose}
      tag={tag}
      onSaved={onSaved}
      onDeleted={onDeleted}
      entityLabel="threads"
      onUpdate={(tagId, params) => updateThreadTag(tagId, params)}
      onDelete={(tagId) => deleteThreadTag(tagId).then(() => undefined)}
    />
  );
}
