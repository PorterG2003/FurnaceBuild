import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { useToast } from '@/components/ui/feedback';
import { buildInteractionIntent } from '@/lib/inbox/buildInteractionIntent';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import { addBlockEntry, removeBlockEntry } from '@/lib/supabase/services';
import type { BlockListEntry } from '@/lib/supabase/types';
import { useInboxInteractionSession } from '@/contexts/InboxInteractionContext';

export interface BlockSenderModalProps {
  visible: boolean;
  onClose: () => void;
  participantEmails: string[];
  accountId: string;
  blockList: BlockListEntry[];
  onBlocked: () => void;
}

export function BlockSenderModal({
  visible,
  onClose,
  participantEmails,
  accountId,
  blockList,
  onBlocked,
}: BlockSenderModalProps) {
  const { toast } = useToast();
  const interactionSession = useInboxInteractionSession();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const uniqueEmails = Array.from(new Set(participantEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)));

  const findEntry = (value: string, type: 'email' | 'domain'): BlockListEntry | undefined =>
    blockList.find(
      (entry) => entry.type === type && entry.value.trim().toLowerCase() === value.trim().toLowerCase()
    );

  const recordBlockInteraction = async (
    type: 'email' | 'domain',
    value: string,
    mode: 'block' | 'unblock'
  ) => {
    const interactionMetadata = parseSmartHandlingMetadata(
      interactionSession.getInteractionSnapshot()?.context.thread.handling_metadata ?? null
    );
    const field = type === 'email' ? 'blocked_email' : 'blocked_domain';
    await interactionSession.recordInteraction({
      action: 'thread.block_sender',
      source: 'block_modal',
      intent: buildInteractionIntent({
        metadata: interactionMetadata,
        actionId: 'block_sender',
      }),
      changes:
        mode === 'block'
          ? [{ field, to: value }]
          : [{ field, from: value, to: null }],
    });
  };

  const handleBlock = async (email: string, type: 'email' | 'domain') => {
    const key = `${email}:${type}:block`;
    setBusyKey(key);
    try {
      const value = type === 'email' ? email : email.split('@')[1] || email;
      if (!value) {
        toast.error('Invalid email');
        return;
      }
      await recordBlockInteraction(type, value, 'block');
      await addBlockEntry(accountId, { value, type });
      onBlocked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to block');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUnblock = async (email: string, type: 'email' | 'domain', entryId: string) => {
    const key = `${email}:${type}:unblock`;
    setBusyKey(key);
    try {
      const value = type === 'email' ? email : email.split('@')[1] || email;
      if (!value) {
        toast.error('Invalid email');
        return;
      }
      await recordBlockInteraction(type, value, 'unblock');
      await removeBlockEntry(accountId, entryId);
      onBlocked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unblock');
    } finally {
      setBusyKey(null);
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
      fitContent
    >
      <View className="gap-3">
        {uniqueEmails.length === 0 ? (
          <Text className="text-gray-400 font-instrument text-sm">
            No prospect emails to block in this thread.
          </Text>
        ) : (
          uniqueEmails.map((email) => {
            const domain = email.includes('@') ? email.split('@')[1] : null;
            const emailEntry = findEntry(email, 'email');
            const domainEntry = domain ? findEntry(domain, 'domain') : undefined;
            const busyEmailBlock = busyKey === `${email}:email:block`;
            const busyEmailUnblock = busyKey === `${email}:email:unblock`;
            const busyDomainBlock = busyKey === `${email}:domain:block`;
            const busyDomainUnblock = busyKey === `${email}:domain:unblock`;

            return (
              <View
                key={email}
                className="flex-row items-center justify-between gap-3 py-2 border-b border-[#2A2A2A] last:border-b-0"
              >
                <Text className="text-gray-200 font-instrument text-sm flex-1" numberOfLines={1}>
                  {email}
                </Text>
                <View className="flex-row gap-2">
                  {emailEntry ? (
                    <Pressable
                      onPress={() => handleUnblock(email, 'email', emailEntry.id)}
                      disabled={!!busyKey}
                      className="px-3 py-1.5 rounded-lg bg-[#2A2A2A] border border-[#3A3A3A]"
                      style={{ opacity: busyKey ? 0.6 : 1 }}
                    >
                      {busyEmailUnblock ? (
                        <ActivityIndicator size="small" color="#9CA3AF" />
                      ) : (
                        <Text className="text-gray-300 font-instrument-medium text-xs">Unblock email</Text>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => handleBlock(email, 'email')}
                      disabled={!!busyKey}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40"
                      style={{ opacity: busyKey ? 0.6 : 1 }}
                    >
                      {busyEmailBlock ? (
                        <ActivityIndicator size="small" color="#F59E0B" />
                      ) : (
                        <Text className="text-amber-400 font-instrument-medium text-xs">Block email</Text>
                      )}
                    </Pressable>
                  )}
                  {domain &&
                    (domainEntry ? (
                      <Pressable
                        onPress={() => handleUnblock(email, 'domain', domainEntry.id)}
                        disabled={!!busyKey}
                        className="px-3 py-1.5 rounded-lg bg-[#2A2A2A] border border-[#3A3A3A]"
                        style={{ opacity: busyKey ? 0.6 : 1 }}
                      >
                        {busyDomainUnblock ? (
                          <ActivityIndicator size="small" color="#9CA3AF" />
                        ) : (
                          <Text className="text-gray-300 font-instrument-medium text-xs">Unblock domain</Text>
                        )}
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => handleBlock(email, 'domain')}
                        disabled={!!busyKey}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40"
                        style={{ opacity: busyKey ? 0.6 : 1 }}
                      >
                        {busyDomainBlock ? (
                          <ActivityIndicator size="small" color="#F59E0B" />
                        ) : (
                          <Text className="text-amber-400 font-instrument-medium text-xs">Block domain</Text>
                        )}
                      </Pressable>
                    ))}
                </View>
              </View>
            );
          })
        )}
      </View>
    </BaseModal>
  );
}
