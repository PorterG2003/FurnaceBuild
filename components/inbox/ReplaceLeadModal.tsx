import { BaseModal } from '@/components/ui/modals/BaseModal';
import { ReplaceLeadScreen } from './ReplaceLeadScreen';
import type { ReplaceLeadCompletionPayload } from '@/lib/inbox/replaceLeadCompletion';
import type { ReplaceLeadPrefill } from '@/lib/inbox/replaceLeadPrefill';
import type { ReplaceLeadWithNewContactResult } from '@/lib/supabase/services/leads';
import type { Lead } from '@/lib/supabase/types';

export interface ReplaceLeadModalProps {
  visible: boolean;
  onClose: () => void;
  oldLead: Lead | null;
  prefill?: ReplaceLeadPrefill | null;
  sourceMessageId?: string | null;
  onReplaced: (result: ReplaceLeadWithNewContactResult, completion: ReplaceLeadCompletionPayload) => void;
}

export function ReplaceLeadModal({
  visible,
  onClose,
  oldLead,
  prefill,
  sourceMessageId,
  onReplaced,
}: ReplaceLeadModalProps) {
  if (!oldLead) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Replace lead"
      description="Move active campaign ownership to the new contact. If they are already in this campaign, the conversation attaches to them instead of creating a second lead."
      maxWidth="3xl"
      maxHeight={1200}
    >
      <ReplaceLeadScreen
        oldLead={oldLead}
        prefill={prefill}
        sourceMessageId={sourceMessageId}
        onReplaced={(result, completion) => {
          onReplaced(result, completion);
          onClose();
        }}
        onCancel={onClose}
        layout="modal"
      />
    </BaseModal>
  );
}
