import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/feedback';
import {
  replaceLeadWithNewContact,
  type ReplaceLeadWithNewContactResult,
} from '@/lib/supabase/services/leads';
import type { ReplacementReason } from '@/lib/supabase/types';

const REPLACEMENT_REASON_OPTIONS: Array<{ id: ReplacementReason; name: string; description: string }> = [
  {
    id: 'manual_referral',
    name: 'Manual referral',
    description: 'The original contact suggested someone else to reach out to.',
  },
  {
    id: 'auto_reply_forward',
    name: 'Auto-reply forward',
    description: 'An automated reply named a better contact.',
  },
  {
    id: 'wrong_contact',
    name: 'Wrong contact',
    description: 'The original recipient was not the right person.',
  },
  {
    id: 'role_change',
    name: 'Role change',
    description: 'The role moved to a different person.',
  },
  {
    id: 'other',
    name: 'Other',
    description: 'Another replacement reason.',
  },
];

export interface ReplaceLeadModalProps {
  visible: boolean;
  onClose: () => void;
  oldLeadId: string;
  oldLeadName?: string | null;
  oldLeadEmail?: string | null;
  sourceMessageId?: string | null;
  onReplaced: (result: ReplaceLeadWithNewContactResult) => void;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ReplaceLeadModal({
  visible,
  onClose,
  oldLeadId,
  oldLeadName,
  oldLeadEmail,
  sourceMessageId,
  onReplaced,
}: ReplaceLeadModalProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState<ReplacementReason>('manual_referral');
  const [reasonNote, setReasonNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setEmail('');
    setName('');
    setReason('manual_referral');
    setReasonNote('');
  }, [visible]);

  const selectedReason = useMemo(
    () => REPLACEMENT_REASON_OPTIONS.find((option) => option.id === reason) ?? REPLACEMENT_REASON_OPTIONS[0],
    [reason]
  );

  const validationError = useMemo(() => {
    if (!email.trim()) return 'Replacement email is required.';
    if (!isValidEmail(email)) return 'Enter a valid email address.';
    if (oldLeadEmail && email.trim().toLowerCase() === oldLeadEmail.trim().toLowerCase()) {
      return 'Replacement email must differ from the current lead email.';
    }
    return null;
  }, [email, oldLeadEmail]);

  const handleSave = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const result = await replaceLeadWithNewContact({
        oldLeadId,
        newEmail: email,
        newName: name || null,
        reason,
        reasonNote: reasonNote || null,
        sourceMessageId: sourceMessageId ?? null,
      });
      toast.success('Replacement lead created.');
      onReplaced(result);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to replace lead.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Replace lead"
      description={`Create a new lead for the new contact and move the active campaign ownership there.${oldLeadEmail ? ` Current lead: ${oldLeadName || oldLeadEmail}` : ''}`}
      maxWidth="md"
      maxHeight={560}
    >
      <View className="gap-4">
        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">New contact email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="sarah@example.com"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            keyboardType="email-address"
            className="text-white font-instrument text-sm px-3 py-3 rounded-xl border border-[#3A3A3A] bg-[#111111]"
          />
        </View>

        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">New contact name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Sarah Johnson"
            placeholderTextColor="#6b7280"
            className="text-white font-instrument text-sm px-3 py-3 rounded-xl border border-[#3A3A3A] bg-[#111111]"
          />
        </View>

        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">Replacement reason</Text>
          <Select<{ id: ReplacementReason; name: string; description: string }>
            items={REPLACEMENT_REASON_OPTIONS}
            getItemId={(item) => item.id}
            getItemLabel={(item) => ({ primary: item.name, secondary: item.description })}
            value={reason}
            onChange={(id, item) => setReason((item?.id ?? id) as ReplacementReason)}
            placeholder="Select reason"
            searchable={false}
            noMargin
          />
          <Text className="text-xs font-instrument text-gray-500 mt-1.5">
            {selectedReason.description}
          </Text>
        </View>

        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">Context note</Text>
          <TextInput
            value={reasonNote}
            onChangeText={setReasonNote}
            placeholder="Optional context from the reply or your notes"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
            className="text-white font-instrument text-sm px-3 py-3 rounded-xl border border-[#3A3A3A] bg-[#111111] min-h-[96px]"
            style={{ minHeight: 96 }}
          />
        </View>

        <View className="rounded-xl border border-[#2A2A2A] bg-[#111111] px-3 py-3">
          <Text className="text-xs font-instrument-medium text-gray-300 mb-1">What happens next</Text>
          <Text className="text-xs font-instrument text-gray-500 leading-5">
            The new lead becomes the active campaign contact. The existing enrollment and future pending work move to
            that new lead, while past sends and events stay attributed to the original lead for audit history.
          </Text>
        </View>

        <View className="flex-row gap-2 flex-wrap">
          <Button
            variant="default"
            className="flex-1 min-w-[120px]"
            onPress={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-instrument-medium">Replace lead</Text>}
          </Button>
          <Button
            variant="secondary"
            className="flex-1 min-w-[120px]"
            onPress={onClose}
            disabled={saving}
          >
            <Text className="text-gray-200 font-instrument-medium">Cancel</Text>
          </Button>
        </View>
      </View>
    </BaseModal>
  );
}
