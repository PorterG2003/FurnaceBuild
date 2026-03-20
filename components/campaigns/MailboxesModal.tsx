import { useState, useEffect, useMemo } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { CheckIcon } from 'react-native-heroicons/outline';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import { assignMailboxesToCampaign } from '@/lib/supabase/services/campaigns';
import { getMailboxesByAccount } from '@/lib/supabase/services/mailboxes';

interface MailboxesModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  campaignId: string;
  accountId: string | null;
  currentMailboxIds: string[];
}

export function MailboxesModal({ visible, onClose, onSaved, campaignId, accountId, currentMailboxIds }: MailboxesModalProps) {
  const [accountMailboxes, setAccountMailboxes] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMailboxes, setIsLoadingMailboxes] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set(currentMailboxIds));
    setSearch('');

    if (accountId) {
      setIsLoadingMailboxes(true);
      getMailboxesByAccount(accountId)
        .then((all) => setAccountMailboxes(all || []))
        .catch(() => setAccountMailboxes([]))
        .finally(() => setIsLoadingMailboxes(false));
    } else {
      setAccountMailboxes([]);
    }
  }, [visible, accountId, currentMailboxIds]);

  const filtered = useMemo(() => {
    if (!search.trim()) return accountMailboxes;
    const q = search.trim().toLowerCase();
    return accountMailboxes.filter(
      (m: any) =>
        (m.email_address || '').toLowerCase().includes(q) ||
        (m.display_name || '').toLowerCase().includes(q)
    );
  }, [accountMailboxes, search]);

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDirty =
    selectedIds.size !== currentMailboxIds.length ||
    currentMailboxIds.some((id) => !selectedIds.has(id)) ||
    [...selectedIds].some((id) => !currentMailboxIds.includes(id));

  const handleClose = useConfirmClose(isDirty, onClose);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await assignMailboxesToCampaign(campaignId, Array.from(selectedIds));
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving mailboxes:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={handleClose}
      title="Mailboxes"
      description={`Select which mailboxes send for this campaign. Selected: ${selectedIds.size}`}
      maxWidth="2xl"
      maxHeight={680}
      footer={
        <ModalFooter>
          <Button onPress={handleClose} variant="secondary">Cancel</Button>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
      footerMobile={
        <ModalFooter>
          <Button onPress={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      }
    >
      <View style={{ marginBottom: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by email or name..."
          placeholderTextColor="#6b7280"
          className="bg-[#121212] border border-[#2A2A2A] rounded-lg px-3 py-2 text-white font-instrument text-sm"
          style={{ borderWidth: 1 }}
        />
      </View>

      {isLoadingMailboxes ? (
        <Text className="text-gray-500 font-instrument text-sm">Loading mailboxes...</Text>
      ) : accountMailboxes.length === 0 ? (
        <Text className="text-gray-500 font-instrument text-sm">
          No mailboxes in this account. Add mailboxes in Senders first.
        </Text>
      ) : filtered.length === 0 ? (
        <Text className="text-gray-500 font-instrument text-sm">
          No mailboxes match your search.
        </Text>
      ) : (
        <View style={{ borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' }}>
            <View style={{ width: 28, marginRight: 8 }} />
            <Text className="text-gray-400 font-instrument-medium text-xs uppercase">Email</Text>
          </View>
          {filtered.map((m: any) => {
            const isSelected = selectedIds.has(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() => handleToggle(m.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: '#2A2A2A',
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    marginRight: 12,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: isSelected ? '#f85102' : '#4B5563',
                    backgroundColor: isSelected ? '#f85102' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && <CheckIcon size={12} color="#fff" />}
                </View>
                <Text className="text-white font-instrument text-sm flex-1" numberOfLines={1}>
                  {m.email_address || m.id}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </BaseModal>
  );
}
