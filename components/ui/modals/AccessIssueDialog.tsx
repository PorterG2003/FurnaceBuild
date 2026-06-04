import { Button } from '@/components/ui/button';
import { BaseModal } from './BaseModal';
import { ModalFooter } from './ModalFooter';

export interface AccessIssueDialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  wide?: boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}

export function AccessIssueDialog({
  visible,
  onClose,
  title,
  message,
  wide = false,
  primaryLabel = 'Continue',
  secondaryLabel,
  onPrimary,
  onSecondary,
}: AccessIssueDialogProps) {
  const footer = (
    <ModalFooter layout="inline">
      {secondaryLabel && onSecondary ? (
        <Button fullWidth variant="secondary" onPress={onSecondary}>
          {secondaryLabel}
        </Button>
      ) : null}
      <Button fullWidth onPress={onPrimary}>
        {primaryLabel}
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={message}
      maxWidth={wide ? 'md' : 'sm'}
      compact
      footer={footer}
      footerMobile={footer}
    />
  );
}
