import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import type { BlockListEntry } from '@/lib/supabase/types';

const PENDING_UNBLOCK_RESET_MS = 4000;

export interface ManageBlockListModalProps {
  visible: boolean;
  onClose: () => void;
  blockList: BlockListEntry[];
  onUnblock: (entryId: string) => Promise<void>;
  unblockingId: string | null;
}

export function ManageBlockListModal({
  visible,
  onClose,
  blockList,
  onUnblock,
  unblockingId,
}: ManageBlockListModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setPendingUnblockId(null);
  }, [visible]);

  useEffect(() => {
    if (!pendingUnblockId) return;
    const t = setTimeout(() => setPendingUnblockId(null), PENDING_UNBLOCK_RESET_MS);
    return () => clearTimeout(t);
  }, [pendingUnblockId]);

  const handleUnblockPress = useCallback(
    (entry: BlockListEntry) => {
      if (pendingUnblockId === entry.id) {
        onUnblock(entry.id);
        setPendingUnblockId(null);
      } else {
        setPendingUnblockId(entry.id);
      }
    },
    [pendingUnblockId, onUnblock]
  );

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return blockList;
    return blockList.filter((e) => e.value.toLowerCase().includes(q));
  }, [blockList, searchQuery]);

  const emptyMessage =
    blockList.length === 0
      ? 'No blocked entries.'
      : `No results for "${searchQuery.trim()}"`;

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Manage Block List"
      description="Blocked addresses and domains do not receive automated campaign emails. You can still reply manually from the inbox."
      maxWidth="2xl"
      maxHeight={560}
    >
      <View className="gap-4">
        <View className="flex-row items-center rounded-lg bg-[#121212] border border-[#2A2A2A] px-3 py-2">
            <MagnifyingGlassIcon size={18} color="#6B7280" style={{ marginRight: 8 }} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search blocked entries..."
              placeholderTextColor="#6B7280"
              className="flex-1 text-white font-instrument text-sm py-1"
              style={{ color: '#FFFFFF' }}
              autoCapitalize="none"
              autoCorrect={false}
            />
        </View>

        {filteredList.length === 0 ? (
            <Text className="text-gray-500 text-sm font-instrument py-8 text-center">
              {emptyMessage}
            </Text>
        ) : (
          <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
          >
            <View className="bg-[#121212] border border-[#2A2A2A] rounded-lg overflow-hidden">
              {filteredList.map((entry, index) => (
                <View
                  key={entry.id}
                  className={`flex-row items-center justify-between px-3 py-2.5 ${
                    index < filteredList.length - 1 ? 'border-b border-[#2A2A2A]' : ''
                  }`}
                >
                  <View className="flex-1 mr-2">
                    <Text className="text-white text-sm font-instrument mb-0.5">
                      {entry.value}
                    </Text>
                    <View className="flex-row">
                      <View
                        className={`rounded px-1.5 py-0.5 self-start ${
                          entry.type === 'email' ? 'bg-amber-500/20' : 'bg-blue-500/20'
                        }`}
                      >
                        <Text
                          className={`text-xs font-instrument-medium ${
                            entry.type === 'email' ? 'text-amber-400' : 'text-blue-400'
                          }`}
                        >
                          {entry.type === 'email' ? 'Email' : 'Domain'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleUnblockPress(entry)}
                    disabled={unblockingId === entry.id}
                    className={`px-2 py-1 rounded active:opacity-70 ${
                      pendingUnblockId === entry.id
                        ? 'bg-brand-orange/20 border border-brand-orange/40'
                        : 'bg-gray-500/20 border border-gray-500/30'
                    }`}
                    activeOpacity={0.7}
                  >
                    {unblockingId === entry.id ? (
                      <ActivityIndicator size="small" color="#9CA3AF" />
                    ) : (
                      <Text
                        className={`text-xs font-instrument-medium ${
                          pendingUnblockId === entry.id ? 'text-brand-orange' : 'text-gray-400'
                        }`}
                      >
                        {pendingUnblockId === entry.id ? 'Click again to confirm' : 'Unblock'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </BaseModal>
  );
}
