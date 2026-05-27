import { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Button } from '@/components/ui/button';
import { BaseModal, ModalFooter } from '@/components/ui/modals';

const CONFIRMATION_TEXT = 'stop';

export interface CampaignStopConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirmStop: () => Promise<void> | void;
  /** When provided, shows a "Pause instead" action (running campaigns only). */
  onPauseInstead?: () => Promise<void> | void;
  campaignName?: string;
  isLoading?: boolean;
  isPausing?: boolean;
}

export function CampaignStopConfirmModal({
  visible,
  onClose,
  onConfirmStop,
  onPauseInstead,
  campaignName,
  isLoading = false,
  isPausing = false,
}: CampaignStopConfirmModalProps) {
  const [confirmationInput, setConfirmationInput] = useState('');
  const busy = isLoading || isPausing;

  useEffect(() => {
    if (!visible) {
      setConfirmationInput('');
    }
  }, [visible]);

  const isConfirmed = confirmationInput.trim() === CONFIRMATION_TEXT;

  const handleClose = () => {
    setConfirmationInput('');
    onClose();
  };

  const handleConfirmStop = async () => {
    await onConfirmStop();
    setConfirmationInput('');
  };

  const handlePauseInstead = async () => {
    if (!onPauseInstead) return;
    await onPauseInstead();
    setConfirmationInput('');
  };

  const description = campaignName
    ? `Stopping "${campaignName}" is permanent. Active and paused leads will be marked stopped, and this campaign cannot be resumed. Pause instead if you only need a temporary break.`
    : 'Stopping is permanent. Active and paused leads will be marked stopped, and this campaign cannot be resumed. Pause instead if you only need a temporary break.';

  const footer = (
    <ModalFooter layout="wrap">
      <Button fullWidth variant="outline" onPress={handleClose} disabled={busy}>
        Cancel
      </Button>
      {onPauseInstead ? (
        <Button fullWidth variant="secondary" onPress={handlePauseInstead} disabled={busy}>
          {isPausing ? 'Pausing...' : 'Pause instead'}
        </Button>
      ) : null}
      <Button
        fullWidth
        variant="destructive"
        onPress={handleConfirmStop}
        disabled={busy || !isConfirmed}
      >
        {isLoading ? 'Stopping...' : 'Stop campaign'}
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Stop campaign?"
      description={description}
      maxWidth="sm"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-2">
        <Text className="text-sm font-instrument-medium text-gray-300">
          Type &quot;{CONFIRMATION_TEXT}&quot; to confirm
        </Text>
        <TextInput
          value={confirmationInput}
          onChangeText={setConfirmationInput}
          placeholder={CONFIRMATION_TEXT}
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
    </BaseModal>
  );
}
