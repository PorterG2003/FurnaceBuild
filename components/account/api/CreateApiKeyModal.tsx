import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { FormTextField, Select } from '@/components/ui/forms';
import { createAccountApiKey, type AccountApiKeyWithSecret } from '@/lib/supabase/services/accounts';
import { MAX_ACTIVE_API_KEYS } from './constants';
import {
  API_KEY_EXPIRY_PRESETS,
  DEFAULT_API_KEY_EXPIRY_PRESET,
  expiresAtFromApiKeyExpiryPreset,
  type ApiKeyExpiryPresetId,
} from './apiKeyExpiry';

export interface CreateApiKeyModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  activeKeyCount: number;
  onCreated: (key: AccountApiKeyWithSecret) => void;
}

export function CreateApiKeyModal({
  visible,
  onClose,
  accountId,
  activeKeyCount,
  onCreated,
}: CreateApiKeyModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [expiryPreset, setExpiryPreset] = useState<ApiKeyExpiryPresetId>(DEFAULT_API_KEY_EXPIRY_PRESET);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setExpiryPreset(DEFAULT_API_KEY_EXPIRY_PRESET);
    }
  }, [visible]);

  const atLimit = activeKeyCount >= MAX_ACTIVE_API_KEYS;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('API key name is required.');
      return;
    }
    if (atLimit) {
      toast.error(`You can have at most ${MAX_ACTIVE_API_KEYS} active API keys.`);
      return;
    }
    setIsSubmitting(true);
    try {
      const key = await createAccountApiKey({
        accountId,
        name: trimmed,
        expiresAt: expiresAtFromApiKeyExpiryPreset(expiryPreset),
      });
      onCreated(key);
      onClose();
      toast.success('API key created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create API key.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Create API key"
      description="Name the key and set an optional expiry. The secret is shown once after creation."
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onPress={handleCreate} disabled={!name.trim() || isSubmitting || atLimit}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleCreate} disabled={!name.trim() || isSubmitting || atLimit}>
            {isSubmitting ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <FormTextField
          label="Key name"
          value={name}
          onChangeText={setName}
          placeholder="Zapier prod"
          editable={!isSubmitting}
          variant="solid"
        />
        <View>
          <Select
            label="Expiry"
            variant="solid"
            items={[...API_KEY_EXPIRY_PRESETS]}
            getItemId={(item) => item.id}
            getItemLabel={(item) => ({ primary: item.label })}
            value={expiryPreset}
            onChange={(id) => setExpiryPreset(id as ApiKeyExpiryPresetId)}
            placeholder="Select expiry…"
            searchable={false}
            disabled={isSubmitting}
          />
          <Text className="text-xs text-gray-500 mt-2 font-instrument">
            The key stops working after this period. Revoke it anytime from Manage.
          </Text>
        </View>
      </View>
    </BaseModal>
  );
}
