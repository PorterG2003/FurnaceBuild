import { View, Text, Pressable } from 'react-native';
import { BaseModal } from './BaseModal';
import { ModalFooter } from './ModalFooter';
import { Button } from '@/components/ui/button';

export interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /**
   * Cancel/Discard button handler. When omitted, the cancel button uses `onClose`
   * (same as X / backdrop). Pass separately when dismiss should not discard.
   */
  onCancel?: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button uses destructive (red) styling. */
  confirmVariant?: 'default' | 'destructive';
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | 'full';
  /** Mobile sheet: max lines for the description. Pass `null` for no limit. */
  descriptionNumberOfLines?: number | null;
}

export function ConfirmModal({
  visible,
  onClose,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  maxWidth = 'sm',
  descriptionNumberOfLines,
}: ConfirmModalProps) {
  const handleCancel = onCancel ?? onClose;

  const confirmButton =
    confirmVariant === 'destructive' ? (
      <Pressable
        onPress={onConfirm}
        style={{
          width: '100%',
          alignSelf: 'stretch',
          paddingVertical: 12,
          paddingHorizontal: 24,
          borderRadius: 12,
          backgroundColor: 'rgba(239, 68, 68, 0.2)',
          borderWidth: 1,
          borderColor: 'rgba(239, 68, 68, 0.4)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text className="font-instrument-medium text-base" style={{ color: '#F87171' }}>
          {confirmLabel}
        </Text>
      </Pressable>
    ) : (
      <Button fullWidth onPress={onConfirm}>
        {confirmLabel}
      </Button>
    );

  const footer = (
    <ModalFooter layout="inline">
      <Button fullWidth onPress={handleCancel} variant="secondary">
        {cancelLabel}
      </Button>
      {confirmButton}
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={message}
      maxWidth={maxWidth}
      descriptionNumberOfLines={descriptionNumberOfLines}
      compact
      footer={footer}
      footerMobile={footer}
    />
  );
}
