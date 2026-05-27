import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/contexts/AccountContext';
import { createSavedLeadListFromGlobalLeadIds } from '@/lib/supabase/services/leads/saved-lists';

export function LeadsCreateListFromSelectionModal({
  visible,
  selectedGlobalLeadIds,
  onClose,
  onCreated,
}: {
  visible: boolean;
  selectedGlobalLeadIds: string[];
  onClose: () => void;
  onCreated: (listId: string) => void;
}) {
  const { account } = useAccount();
  const [listName, setListName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const count = selectedGlobalLeadIds.length;
    setListName(`List from ${count} lead${count === 1 ? '' : 's'}`);
    setError(null);
  }, [selectedGlobalLeadIds, visible]);

  const handleClose = useCallback(() => {
    if (saving) return;
    setError(null);
    onClose();
  }, [onClose, saving]);

  const handleCreate = useCallback(async () => {
    if (!account?.id) {
      setError('No active account found.');
      return;
    }
    if (selectedGlobalLeadIds.length === 0) {
      setError('Select at least one lead first.');
      return;
    }
    const trimmedName = listName.trim();
    if (!trimmedName) {
      setError('Enter a list name.');
      return;
    }
    try {
      setSaving(true);
      const nextList = await createSavedLeadListFromGlobalLeadIds(account.id, {
        name: trimmedName,
        globalLeadIds: selectedGlobalLeadIds,
      });
      setError(null);
      onClose();
      onCreated(nextList.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create list.');
    } finally {
      setSaving(false);
    }
  }, [account?.id, listName, onClose, onCreated, selectedGlobalLeadIds]);

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={handleClose} disabled={saving}>
        Cancel
      </Button>
      <Button onPress={() => void handleCreate()} disabled={saving}>
        Create list
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Create list from selection"
      description={`Save ${selectedGlobalLeadIds.length} selected lead${selectedGlobalLeadIds.length === 1 ? '' : 's'} as a new workbench list.`}
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {saving ? <LoadingState message="Creating saved list..." className="py-8" /> : null}
        {error ? <Alert variant="error" message={error} /> : null}
        <View>
          <Text className="text-gray-500 font-instrument text-xs uppercase mb-2">List name</Text>
          <TextInput
            value={listName}
            onChangeText={setListName}
            placeholder="List name"
            placeholderTextColor="#6B7280"
            className="border border-[#2A2A2A] rounded-xl px-4 py-3 bg-[#121212] text-white font-instrument min-h-[44px]"
            editable={!saving}
          />
        </View>
      </View>
    </BaseModal>
  );
}
