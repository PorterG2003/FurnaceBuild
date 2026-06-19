import React from 'react';
import { View, Text, Pressable } from 'react-native';
import {
  CalendarDaysIcon,
  NoSymbolIcon,
  TagIcon,
  FolderIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from 'react-native-heroicons/outline';
import { BottomSheet } from '@/components/ui/modals';
import type { EmailThread } from '@/lib/supabase/types';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { OPEN_CONVERSATION_COLOR, THREAD_CATEGORIES } from './inboxConstants';

export interface InboxMessageActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  accountId: string | null;
  selectedThreadId: string | null;
  selectedThread: EmailThread | null;
  threadTagsMap: Record<string, ThreadTag[]>;
  selectedThreadProspectEmails: string[];
  campaignName: string | null;
  replacementSummary: LeadReplacementSummary | null;
  onBlock: () => void;
  onMarkOutOfOffice?: () => void;
  onReplaceLead?: () => void;
  onCloseConversation?: () => void;
  onOpenConversation?: () => void;
  onTags: () => void;
  onShowInfo: () => void;
  onSetCategory: (category: string | null) => Promise<void>;
  /** Called after this sheet finishes its close animation (see BottomSheet `onAfterClose`). */
  onAfterClose?: () => void;
}

export function InboxMessageActionsSheet({
  visible,
  onClose,
  accountId,
  selectedThreadId,
  selectedThread,
  threadTagsMap,
  selectedThreadProspectEmails,
  campaignName,
  replacementSummary,
  onBlock,
  onMarkOutOfOffice,
  onReplaceLead,
  onCloseConversation,
  onOpenConversation,
  onTags,
  onShowInfo,
  onSetCategory,
  onAfterClose,
}: InboxMessageActionsSheetProps) {
  const tagCount = selectedThreadId ? (threadTagsMap[selectedThreadId] ?? []).length : 0;
  const hasInfo = !!campaignName || !!replacementSummary;

  return (
    <BottomSheet visible={visible} onClose={onClose} onAfterClose={onAfterClose}>
      {accountId && selectedThreadId && selectedThread && (
        <>
          {hasInfo && (
            <Pressable
              onPress={() => {
                onShowInfo();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <InformationCircleIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base">Info</Text>
            </Pressable>
          )}
          {!!accountId && selectedThreadProspectEmails.length > 0 && (
            <Pressable
              onPress={() => {
                onBlock();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <NoSymbolIcon size={20} color="#F87171" />
              <Text className="text-white font-instrument-medium text-base">Block sender</Text>
            </Pressable>
          )}
          {!!accountId && selectedThreadId && onMarkOutOfOffice && (
            <Pressable
              onPress={() => {
                onMarkOutOfOffice();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <CalendarDaysIcon size={20} color="#93C5FD" />
              <Text className="text-white font-instrument-medium text-base">Out of office</Text>
            </Pressable>
          )}
          {!!accountId && selectedThread?.lead_id && onReplaceLead && (
            <Pressable
              onPress={() => {
                onReplaceLead();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <ArrowPathIcon size={20} color="#FDBA74" />
              <Text className="text-white font-instrument-medium text-base">Replace + forward</Text>
            </Pressable>
          )}
          {onCloseConversation && (
            <Pressable
              onPress={() => {
                onCloseConversation();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <CheckCircleIcon size={20} color={OPEN_CONVERSATION_COLOR} />
              <Text className="text-white font-instrument-medium text-base">Close conversation</Text>
            </Pressable>
          )}
          {onOpenConversation && (
            <Pressable
              onPress={() => {
                onOpenConversation();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: '#2A2A2A',
              }}
            >
              <CheckCircleIcon size={20} color={OPEN_CONVERSATION_COLOR} />
              <Text className="text-white font-instrument-medium text-base">Open conversation</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              onTags();
              onClose();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: '#2A2A2A',
            }}
          >
            <TagIcon size={20} color="#9CA3AF" />
            <Text className="text-white font-instrument-medium text-base">
              Tags{tagCount > 0 ? ` (${tagCount})` : ''}
            </Text>
          </Pressable>
          <View
            style={{
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: '#2A2A2A',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <FolderIcon size={20} color="#9CA3AF" />
              <Text className="text-white font-instrument-medium text-base">Set category</Text>
            </View>
            {['', ...THREAD_CATEGORIES].map((cat) => {
              const label = cat === '' ? 'No category' : cat;
              const isSelected = (selectedThread?.category ?? null) === (cat || null);
              return (
                <Pressable
                  key={cat || '__none__'}
                  onPress={async () => {
                    try {
                      await onSetCategory(cat || null);
                      onClose();
                    } catch (e) {
                      console.error('Failed to update category:', e);
                    }
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    paddingLeft: 32,
                  }}
                >
                  <Text
                    className="font-instrument text-base"
                    style={{ color: isSelected ? '#f85102' : '#9CA3AF' }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </BottomSheet>
  );
}
