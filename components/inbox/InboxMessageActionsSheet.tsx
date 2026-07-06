import React, { useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TagIcon,
  FolderIcon,
  InformationCircleIcon,
} from 'react-native-heroicons/outline';
import {
  BottomSheet,
  BOTTOM_SHEET_HORIZONTAL_PADDING,
  getBottomSheetBodyScrollMaxHeight,
} from '@/components/ui/modals';
import { OnboardingHost } from '@/components/onboarding';
import { useOnboardingHostActive } from '@/components/onboarding';
import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { TARGETS } from '@/lib/onboarding/types';
import { buildInboxThreadToolbarActions, type InboxThreadToolbarActionKey } from '@/lib/inbox';
import type { EmailThread } from '@/lib/supabase/types';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import { THREAD_CATEGORIES } from './inboxConstants';
import { INBOX_THREAD_TOOLBAR_ICON_MAP } from './inboxThreadToolbarIcons';
import { getMessageToolbarToneColors } from './messageToolbarStyles';

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
  const hostActive = useOnboardingHostActive('inboxMessageActions');
  const scrollRef = useRef<ScrollView | null>(null);
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bodyMaxHeight = getBottomSheetBodyScrollMaxHeight(screenHeight, insets.bottom);
  // While an onboarding step is highlighting a row, taps are inert (the tour
  // drives progression) so a demo tap never fires a real action or closes.
  const guard = (fn: () => void) => () => {
    if (hostActive) return;
    fn();
  };

  // Registered on the `inboxMessageActions` surface so these refs never
  // collide with the desktop toolbar/header, which registers the same
  // TargetIds on the default `'global'` surface.
  const sheetActionsRef = useOnboardingTarget(TARGETS.inboxSheetActions, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const closeActionRef = useOnboardingTarget(TARGETS.inboxActionClose, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const blockActionRef = useOnboardingTarget(TARGETS.inboxActionBlock, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const outOfOfficeActionRef = useOnboardingTarget(TARGETS.inboxActionOutOfOffice, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const replaceActionRef = useOnboardingTarget(TARGETS.inboxActionReplace, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const tagsActionRef = useOnboardingTarget(TARGETS.inboxActionTags, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const categoryActionRef = useOnboardingTarget(TARGETS.inboxActionCategory, {
    enabled: visible,
    surface: 'inboxMessageActions',
  });
  const tagCount = selectedThreadId ? (threadTagsMap[selectedThreadId] ?? []).length : 0;
  const hasInfo = !!campaignName || !!replacementSummary;
  const actionTargetRefs = useMemo<Partial<Record<InboxThreadToolbarActionKey, typeof closeActionRef>>>(
    () => ({
      close: closeActionRef,
      block: blockActionRef,
      ooo: outOfOfficeActionRef,
      replace: replaceActionRef,
      tags: tagsActionRef,
    }),
    [blockActionRef, closeActionRef, outOfOfficeActionRef, replaceActionRef, tagsActionRef],
  );
  const toolbarActions = useMemo(
    () =>
      buildInboxThreadToolbarActions({
        showBlockButton: !!accountId && selectedThreadProspectEmails.length > 0,
        onBlock,
        showOutOfOfficeButton: !!accountId && !!selectedThreadId,
        onMarkOutOfOffice,
        showReplaceLeadButton: !!accountId && !!selectedThread?.lead_id,
        onReplaceLead,
        showCloseConversationButton: !!onCloseConversation,
        onCloseConversation,
        showOpenConversationButton: !!onOpenConversation,
        onOpenConversation,
        onOpenTagsPanel: onTags,
        tagCount,
      }),
    [
      accountId,
      onBlock,
      onCloseConversation,
      onMarkOutOfOffice,
      onOpenConversation,
      onReplaceLead,
      onTags,
      selectedThread?.lead_id,
      selectedThreadId,
      selectedThreadProspectEmails.length,
      tagCount,
    ],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onAfterClose={onAfterClose}
      dismissLocked={hostActive}
      registerAsBlocking={!hostActive}
      wrapSheetInterior={(interior) => (
        <OnboardingHost
          hostId="inboxMessageActions"
          active={visible}
          scrollRef={scrollRef}
          style={{
            marginHorizontal: -BOTTOM_SHEET_HORIZONTAL_PADDING,
            paddingHorizontal: BOTTOM_SHEET_HORIZONTAL_PADDING,
          }}
        >
          {interior}
        </OnboardingHost>
      )}
    >
      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: bodyMaxHeight }}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
          {accountId && selectedThreadId && selectedThread && (
            <View ref={sheetActionsRef} collapsable={false}>
              {hasInfo && (
                <Pressable
                  onPress={guard(() => {
                    onShowInfo();
                    onClose();
                  })}
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
              {toolbarActions.map((action) => {
                const toneColors = getMessageToolbarToneColors(action.tone ?? 'default');
                const Icon = INBOX_THREAD_TOOLBAR_ICON_MAP[action.iconKey];
                return (
                  <Pressable
                    ref={actionTargetRefs[action.key]}
                    key={action.key}
                    onPress={guard(() => {
                      action.onPress();
                      onClose();
                    })}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: '#2A2A2A',
                    }}
                  >
                    <Icon size={20} color={toneColors.iconColor} />
                    <Text className="text-white font-instrument-medium text-base">{action.label}</Text>
                  </Pressable>
                );
              })}
              <View
                ref={categoryActionRef}
                collapsable={false}
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
                      onPress={guard(() => {
                        void (async () => {
                          try {
                            await onSetCategory(cat || null);
                            onClose();
                          } catch (e) {
                            console.error('Failed to update category:', e);
                          }
                        })();
                      })}
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
            </View>
          )}
      </ScrollView>
    </BottomSheet>
  );
}
