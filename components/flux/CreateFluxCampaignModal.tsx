import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';

interface CreateFluxCampaignModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  isLoading: boolean;
}

export function CreateFluxCampaignModal({
  visible,
  onClose,
  onCreate,
  isLoading,
}: CreateFluxCampaignModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }
    setError('');
    try {
      await onCreate(name.trim());
      setName('');
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    }
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Create Flux campaign"
      description="Name your campaign, then configure the template and prospects."
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onPress={handleCreate} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create campaign'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleCreate} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create campaign'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="mb-2">
        <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Campaign name</Text>
        <TextInput
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError('');
          }}
          placeholder="e.g. Q1 dental owners"
          placeholderTextColor="#666"
          className="rounded-xl px-4 py-3 text-base text-white border border-[#FFFFFF4D] bg-[#FFFFFF0D]"
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          autoFocus
        />
      </View>
      {error ? (
        <View className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
          <Text className="text-red-400 text-center font-instrument-medium text-sm">{error}</Text>
        </View>
      ) : null}
    </BaseModal>
  );
}
