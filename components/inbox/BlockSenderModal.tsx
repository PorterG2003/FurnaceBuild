import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { useToast } from '@/components/ui/feedback';
import { buildInteractionIntent } from '@/lib/inbox/buildInteractionIntent';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import { addBlockEntry } from '@/lib/supabase/services';
import { useInboxInteractionSession } from '@/contexts/InboxInteractionContext';

export interface BlockSenderModalProps {
  visible: boolean;
  onClose: () => void;
  participantEmails: string[];
  accountId: string;
  onBlocked: () => void;
}

export function BlockSenderModal({
  visible,
  onClose,
  participantEmails,
  accountId,
  onBlocked,
}: BlockSenderModalProps) {
  const { toast } = useToast();
  const interactionSession = useInboxInteractionSession();
  const [adding, setAdding] = useState<string | null>(null);

  const uniqueEmails = Array.from(new Set(participantEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)));

  const handleBlock = async (email: string, type: 'email' | 'domain') => {
    setAdding(`${email}:${type}`);
    try {
      const value = type === 'email' ? email : email.split('@')[1] || email;
      if (!value) {
        toast.error('Invalid email');
        setAdding(null);
        return;
      }
      const interactionMetadata = parseSmartHandlingMetadata(
        interactionSession.getInteractionSnapshot()?.context.thread.handling_metadata ?? null
      );
      await interactionSession.recordInteraction({
        action: 'thread.block_sender',
        source: 'block_modal',
        intent: buildInteractionIntent({
          metadata: interactionMetadata,
          actionId: 'block_sender',
        }),
        changes: [{ field: type === 'email' ? 'blocked_email' : 'blocked_domain', to: value }],
      });
      await addBlockEntry(accountId, { value, type });
      onBlocked();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to block');
    } finally {
      setAdding(null);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Block sender"
      description="Block this email or domain to prevent automated campaign emails from being sent. Manual replies from the inbox are still allowed."
      maxWidth="md"
      maxHeight={480}
    >
      <View className="gap-3">
        {uniqueEmails.length === 0 ? (
          <Text className="text-gray-400 font-instrument text-sm">
            No prospect emails to block in this thread.
          </Text>
        ) : (
          uniqueEmails.map((email) => {
            const domain = email.includes('@') ? email.split('@')[1] : null;
            const addingEmail = adding?.startsWith(`${email}:`);
            return (
              <View
                key={email}
                className="flex-row items-center justify-between gap-3 py-2 border-b border-[#2A2A2A] last:border-b-0"
              >
                <Text className="text-gray-200 font-instrument text-sm flex-1" numberOfLines={1}>
                  {email}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => handleBlock(email, 'email')}
                    disabled={!!adding}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40"
                    style={{ opacity: adding ? 0.6 : 1 }}
                  >
                    {addingEmail && adding?.endsWith(':email') ? (
                      <ActivityIndicator size="small" color="#F59E0B" />
                    ) : (
                      <Text className="text-amber-400 font-instrument-medium text-xs">Block email</Text>
                    )}
                  </Pressable>
                  {domain && (
                    <Pressable
                      onPress={() => handleBlock(email, 'domain')}
                      disabled={!!adding}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40"
                      style={{ opacity: adding ? 0.6 : 1 }}
                    >
                      {addingEmail && adding?.endsWith(':domain') ? (
                        <ActivityIndicator size="small" color="#F59E0B" />
                      ) : (
                        <Text className="text-amber-400 font-instrument-medium text-xs">Block domain</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </BaseModal>
  );
}
