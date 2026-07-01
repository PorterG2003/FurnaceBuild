import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { FormTextField } from '@/components/ui/forms';
import { updateCampaign } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';

export interface RenameCampaignModalProps {
  visible: boolean;
  campaign: { id: string; name: string } | null;
  onClose: () => void;
  onRenamed: (updated: Campaign) => void;
}

export function RenameCampaignModal({
  visible,
  campaign,
  onClose,
  onRenamed,
}: RenameCampaignModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible && campaign) {
      setName(campaign.name);
      setError('');
    }
  }, [visible, campaign]);

  const handleClose = () => {
    setError('');
    onClose();
  };

  const handleSave = async () => {
    if (!campaign) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Campaign name is required');
      return;
    }

    if (trimmed === campaign.name.trim()) {
      handleClose();
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const updated = await updateCampaign(campaign.id, { name: trimmed });
      onRenamed(updated);
      handleClose();
      toast.success('Campaign renamed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename campaign');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!campaign) return null;

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Rename Campaign"
      description={`Update the name for ${campaign.name}.`}
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onPress={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      <View>
        <FormTextField
          label="Campaign name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError('');
          }}
          placeholder="Enter campaign name"
          editable={!isSubmitting}
          variant="solid"
          autoFocus
        />
        {error ? (
          <View className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
            <Text className="text-red-400 text-center font-instrument-medium text-sm">
              {error}
            </Text>
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
}
