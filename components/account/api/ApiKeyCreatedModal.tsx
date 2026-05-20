import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Alert, useToast } from '@/components/ui/feedback';
import type { AccountApiKeyWithSecret } from '@/lib/supabase/services/accounts';

export interface ApiKeyCreatedModalProps {
  visible: boolean;
  createdKey: AccountApiKeyWithSecret | null;
  onClose: () => void;
}

export function ApiKeyCreatedModal({ visible, createdKey, onClose }: ApiKeyCreatedModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      setCopied(false);
    }
  }, [visible, createdKey?.id]);

  const handleCopy = async () => {
    if (!createdKey) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(createdKey.secret);
      setCopied(true);
      toast.success('API key copied.');
      return;
    }
    setCopied(true);
    toast.info(`API key: ${createdKey.secret}`);
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="API Key Created"
      description="This secret is shown only once. Copy it now and store it somewhere safe before closing."
      maxWidth="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button onPress={() => void handleCopy()} disabled={!createdKey}>
            {copied ? 'Copied' : 'Copy key'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={() => void handleCopy()} disabled={!createdKey}>
            {copied ? 'Copied' : 'Copy key'}
          </Button>
        </ModalFooter>
      }
    >
      <View className="gap-4">
        <Alert
          variant="warning"
          message="Furnace will not show this API key again. Store it in a password manager, secret vault, or another safe place before closing this dialog."
        />

        <View className="p-3 rounded-lg border border-[#2A2A2A] bg-[#121212] gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-xs text-gray-400 font-instrument-medium">
              API key secret
            </Text>
            <Button variant="secondary" size="xs" onPress={() => void handleCopy()} disabled={!createdKey}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </View>
          <Text selectable className="text-sm text-white font-instrument">
            {createdKey?.secret ?? ''}
          </Text>
        </View>

        <Text className="text-xs text-gray-500 leading-5">
          Anyone with this key can use your Client API access. Treat it like a password.
        </Text>
      </View>
    </BaseModal>
  );
}
