import { BaseModal } from '@/components/ui/modals/BaseModal';
import { ReplaceLeadScreen } from './ReplaceLeadScreen';
import type { ReplaceLeadWithNewContactResult } from '@/lib/supabase/services/leads';
import type { Lead } from '@/lib/supabase/types';

export interface ReplaceLeadModalProps {
  visible: boolean;
  onClose: () => void;
  oldLead: Lead | null;
  sourceMessageId?: string | null;
  onReplaced: (result: ReplaceLeadWithNewContactResult) => void;
}

export function ReplaceLeadModal({
  visible,
  onClose,
  oldLead,
  sourceMessageId,
  onReplaced,
}: ReplaceLeadModalProps) {
  if (!oldLead) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Replace lead"
      description="Create a new lead for the new contact and move the active campaign ownership there."
      maxWidth="3xl"
      maxHeight={1200}
    >
      <ReplaceLeadScreen
        oldLead={oldLead}
        sourceMessageId={sourceMessageId}
        onReplaced={(result) => {
          onReplaced(result);
          onClose();
        }}
        onCancel={onClose}
        layout="modal"
      />
    </BaseModal>
  );
}
