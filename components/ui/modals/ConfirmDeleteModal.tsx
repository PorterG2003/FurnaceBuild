import { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Button } from '@/components/ui/button';
import { BaseModal } from './BaseModal';
import { ModalFooter } from './ModalFooter';

interface ConfirmDeleteModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  itemName?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  requireConfirmation?: boolean;
  confirmationText?: string;
}

export function ConfirmDeleteModal({
  visible,
  onClose,
  onConfirm,
  title,
  itemName,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isLoading = false,
  requireConfirmation = true,
  confirmationText,
}: ConfirmDeleteModalProps) {
  const [confirmationInput, setConfirmationInput] = useState('');
  const confirmationRequired = confirmationText || itemName || 'DELETE';

  // Reset input when modal closes
  useEffect(() => {
    if (!visible) {
      setConfirmationInput('');
    }
  }, [visible]);

  const handleConfirm = async () => {
    await onConfirm();
    setConfirmationInput('');
  };

  const handleClose = () => {
    setConfirmationInput('');
    onClose();
  };

  const isConfirmed = requireConfirmation
    ? confirmationInput.trim() === confirmationRequired
    : true;

  const defaultDescription = itemName
    ? `Are you sure you want to delete "${itemName}"? This action cannot be undone.`
    : 'Are you sure you want to delete this item? This action cannot be undone.';

  const confirmationPrompt = requireConfirmation
    ? itemName
      ? `Type "${itemName}" to confirm`
      : confirmationText
      ? `Type "${confirmationText}" to confirm`
      : 'Type "DELETE" to confirm'
    : undefined;

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title={title}
      description={description || defaultDescription}
      maxWidth="sm"
      compact={!requireConfirmation}
      footer={
        <ModalFooter layout="inline">
          <Button fullWidth variant="outline" onPress={handleClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            fullWidth
            variant="destructive"
            onPress={handleConfirm}
            disabled={isLoading || !isConfirmed}
          >
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button
            variant="destructive"
            onPress={handleConfirm}
            disabled={isLoading || !isConfirmed}
          >
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </ModalFooter>
      }
    >
      {requireConfirmation && (
        <View className="gap-2">
          <Text className="text-sm font-instrument-medium text-gray-300">
            {confirmationPrompt}
          </Text>
          <TextInput
            value={confirmationInput}
            onChangeText={setConfirmationInput}
            placeholder={confirmationRequired}
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: isConfirmed ? '#FFFFFF4D' : '#F871714D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>
      )}
    </BaseModal>
  );
}

