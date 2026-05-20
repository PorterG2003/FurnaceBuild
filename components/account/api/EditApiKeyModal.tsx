import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BaseModal, ConfirmDeleteModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback';
import { FormTextField } from '@/components/ui/forms';
import type { AccountApiKey } from '@/lib/supabase/types';
import { renameAccountApiKey, revokeAccountApiKey } from '@/lib/supabase/services/accounts';

export interface EditApiKeyModalProps {
  visible: boolean;
  onClose: () => void;
  accountId: string;
  apiKey: AccountApiKey | null;
  onSaved: () => void;
  onRevoked: () => void;
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function MetaRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-2.5">
      <Text className="text-sm text-gray-500 font-instrument">{label}</Text>
      <Text
        className={`text-sm font-instrument text-right flex-1 ${
          muted ? 'text-gray-500' : 'text-gray-200'
        }`}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

export function EditApiKeyModal({
  visible,
  onClose,
  accountId,
  apiKey,
  onSaved,
  onRevoked,
}: EditApiKeyModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    if (visible && apiKey) {
      setName(apiKey.name);
      setShowRevokeConfirm(false);
    }
  }, [visible, apiKey]);

  const handleSave = async () => {
    if (!apiKey) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('API key name is required.');
      return;
    }
    setIsSubmitting(true);
    try {
      await renameAccountApiKey({
        accountId,
        keyId: apiKey.id,
        name: trimmed,
      });
      onSaved();
      onClose();
      toast.success('API key renamed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename API key.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!apiKey) return;
    setIsRevoking(true);
    try {
      await revokeAccountApiKey({ accountId, keyId: apiKey.id });
      setShowRevokeConfirm(false);
      onRevoked();
      onClose();
      toast.success('API key revoked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke API key.');
    } finally {
      setIsRevoking(false);
    }
  };

  if (!apiKey) return null;

  const isRevoked = !!apiKey.revoked_at;
  const statusLabel = isRevoked ? 'Revoked' : 'Active';

  return (
    <>
      <BaseModal
        visible={visible && !showRevokeConfirm}
        onClose={onClose}
        title={apiKey.name}
        description={`${apiKey.secret_prefix}… · ${statusLabel}`}
        maxWidth="md"
        footer={
          <ModalFooter layout="inline">
            <Button variant="secondary" fullWidth onPress={onClose} disabled={isSubmitting}>
              {isRevoked ? 'Close' : 'Cancel'}
            </Button>
            {!isRevoked ? (
              <Button fullWidth onPress={handleSave} disabled={!name.trim() || isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            ) : null}
          </ModalFooter>
        }
        footerMobile={
          <ModalFooter>
            {!isRevoked ? (
              <Button onPress={handleSave} disabled={!name.trim() || isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            ) : (
              <Button variant="secondary" onPress={onClose}>
                Close
              </Button>
            )}
          </ModalFooter>
        }
      >
        <View>
          {!isRevoked ? (
            <FormTextField
              label="Display name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Zapier prod"
              editable={!isSubmitting}
              variant="solid"
            />
          ) : null}

          <View className={isRevoked ? '' : 'mt-6 pt-5 border-t border-[#2A2A2A]'}>
            <MetaRow label="Expires" value={formatDateShort(apiKey.expires_at)} muted={!apiKey.expires_at} />
            <MetaRow label="Last used" value={formatDateShort(apiKey.last_used_at)} muted={!apiKey.last_used_at} />
            <MetaRow label="Created" value={formatDateShort(apiKey.created_at)} />
          </View>

          {!isRevoked ? (
            <View className="mt-6 pt-5 border-t border-[#2A2A2A]">
              <Button
                variant="destructive"
                size="sm"
                fullWidth
                onPress={() => setShowRevokeConfirm(true)}
                disabled={isSubmitting}
              >
                Revoke key
              </Button>
            </View>
          ) : null}
        </View>
      </BaseModal>

      <ConfirmDeleteModal
        visible={showRevokeConfirm}
        onClose={() => setShowRevokeConfirm(false)}
        onConfirm={handleRevoke}
        title="Revoke API key"
        itemName={apiKey.name}
        description="This key will stop working immediately. You cannot undo this action."
        confirmLabel="Revoke"
        isLoading={isRevoking}
        requireConfirmation={false}
      />
    </>
  );
}
