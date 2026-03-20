import { View, Text, Pressable } from 'react-native';
import { BaseModal } from './BaseModal';
import { ModalFooter } from './ModalFooter';
import { Button } from '@/components/ui/button';

export interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button uses destructive (red) styling. */
  confirmVariant?: 'default' | 'destructive';
}

export function ConfirmModal({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
}: ConfirmModalProps) {
  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={message}
      maxWidth="sm"
      compact
      footer={
        <ModalFooter>
          <Button onPress={onClose} variant="secondary">
            {cancelLabel}
          </Button>
          {confirmVariant === 'destructive' ? (
            <Pressable
              onPress={onConfirm}
              style={{
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
            <Button onPress={onConfirm}>{confirmLabel}</Button>
          )}
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          {confirmVariant === 'destructive' ? (
            <Pressable
              onPress={onConfirm}
              style={{
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
            <Button onPress={onConfirm}>{confirmLabel}</Button>
          )}
        </ModalFooter>
      }
    />
  );
}
