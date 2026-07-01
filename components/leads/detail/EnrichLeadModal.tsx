import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { AccountLeadDetail } from '@/lib/leads/types';
import { EnrichLeadScreen } from './EnrichLeadScreen';
import { ENRICH_COPY } from './enrichCopy';

export interface EnrichLeadModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  detail: AccountLeadDetail;
  onApplied: () => void;
}

export function EnrichLeadModal({
  visible,
  onClose,
  accountId,
  detail,
  onApplied,
}: EnrichLeadModalProps) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={ENRICH_COPY.title}
      maxWidth="3xl"
      maxHeight={1200}
    >
      {visible ? (
        <EnrichLeadScreen
          accountId={accountId}
          detail={detail}
          onApplied={() => {
            onApplied();
            onClose();
          }}
          onCancel={onClose}
        />
      ) : null}
    </BaseModal>
  );
}
