import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/contexts/AccountContext';
import type { AccountLeadExplorerQuery } from '@/lib/supabase/services/leads/account-leads';
import { createSavedLeadListFromExplorerView } from '@/lib/supabase/services/leads/saved-lists';

const LARGE_VIEW_THRESHOLD = 5000;

export function LeadsSaveViewAsListModal({
  visible,
  explorerQuery,
  matchingCount,
  onClose,
  onCreated,
}: {
  visible: boolean;
  explorerQuery: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
  matchingCount: number;
  onClose: () => void;
  onCreated: (listId: string) => void;
}) {
  const { account } = useAccount();
  const [listName, setListName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Creating saved list...');

  useEffect(() => {
    if (!visible) return;
    setListName(`View (${matchingCount.toLocaleString()} lead${matchingCount === 1 ? '' : 's'})`);
    setError(null);
    setLoadingMessage('Creating saved list...');
  }, [matchingCount, visible]);

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
    if (matchingCount === 0) {
      setError('No leads match the current view.');
      return;
    }
    const trimmedName = listName.trim();
    if (!trimmedName) {
      setError('Enter a list name.');
      return;
    }
    try {
      setSaving(true);
      if (matchingCount > 1000) {
        setLoadingMessage('Loading leads from view...');
      }
      const nextList = await createSavedLeadListFromExplorerView(account.id, {
        name: trimmedName,
        query: explorerQuery,
      });
      setError(null);
      onClose();
      onCreated(nextList.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create list.');
    } finally {
      setSaving(false);
      setLoadingMessage('Creating saved list...');
    }
  }, [account?.id, explorerQuery, listName, matchingCount, onClose, onCreated]);

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={handleClose} disabled={saving}>
        Cancel
      </Button>
      <Button onPress={() => void handleCreate()} disabled={saving || matchingCount === 0}>
        Save list
      </Button>
    </ModalFooter>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Save view as list"
      description={`Save all ${matchingCount.toLocaleString()} lead${matchingCount === 1 ? '' : 's'} matching the current search and filters as a static list.`}
      maxWidth="lg"
      footer={footer}
      footerMobile={footer}
    >
      <View className="gap-4">
        {saving ? <LoadingState message={loadingMessage} className="py-8" /> : null}
        {error ? <Alert variant="error" message={error} /> : null}
        {matchingCount > LARGE_VIEW_THRESHOLD && !saving ? (
          <Alert
            variant="warning"
            message={`This view has ${matchingCount.toLocaleString()} leads. Saving may take a moment.`}
          />
        ) : null}
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
