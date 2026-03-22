import React, { type RefObject } from 'react';
import { View, Text, ScrollView, Animated } from 'react-native';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { Campaign } from '@/lib/supabase/types';
import { MessagePanelHeaderSkeleton } from './MessageListSkeleton';
import { MessageListSkeleton } from './MessageListSkeleton';
import { InboxThreadList } from './InboxThreadList';
import { InboxMessageList } from './InboxMessageList';
import { InboxComposerPanel } from './InboxComposerPanel';
import { THREAD_CATEGORIES } from './inboxConstants';
import type { PendingReplyInfo } from './InboxMessageList';
import type { InboxComposerFormProps } from './InboxComposerForm';

export interface InboxDesktopThreadListProps {
  threads: EmailThread[];
  displayThreads: EmailThread[];
  threadsError: string | null;
  threadsLoadingOrNoAccount: boolean;
  showThreadSkeleton: boolean;
  threadSearchQuery: string;
  setThreadSearchQuery: (q: string) => void;
  filterButtonRef: RefObject<View | null>;
  onFilterPress: () => void;
  hasActiveFilters: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  loadMoreThreads: () => void;
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  leadDisplayNamesMap: Record<string, string>;
  campaigns: Campaign[];
  threadSnippetsMap: Record<string, string>;
  threadTagsMap: Record<string, ThreadTag[]>;
  onSelectThread: (threadId: string) => void;
  selectedThreadId: string | null;
  onRetryLoadThreads: () => void;
  scrollPaddingBottom: number;
}

export interface InboxDesktopMessagePaneProps {
  selectedThread: EmailThread | undefined;
  displayMessages: EmailMessage[];
  messagesError: string | null;
  showMessagesSkeleton: boolean;
  loadMessages: (threadId: string, options?: { silent?: boolean }) => void;
  selectedThreadProspectEmails: string[];
  blockedProspectEmails: Set<string>;
  accountId: string | null;
  onBlock: (() => void) | undefined;
  onOpenTagsPanel: (() => void) | undefined;
  onSetCategory: ((cat: string | null) => Promise<void>) | undefined;
  messagesScrollViewRef: RefObject<ScrollView | null>;
  onContentSizeChange: (width: number, height: number) => void;
  onReply: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  onDownloadAttachment: ((emailMessageId: string, part: string, filename: string) => Promise<void>) | undefined;
  onFetchAttachmentPreview: ((emailMessageId: string, part: string) => Promise<Blob | null>) | undefined;
  pendingReply: PendingReplyInfo | null;
  onRetryFailedReply: () => void;
}

export interface InboxDesktopLayoutOptions {
  slideAnim: Animated.Value;
  replyPanelWidth: number;
}

export interface InboxDesktopComposerPanelProps {
  composerMode: 'reply' | 'forward' | null;
  closeComposerPanel: () => void;
  composerFormProps: Omit<InboxComposerFormProps, 'mode' | 'onCancel'>;
}

export interface InboxDesktopLayoutProps {
  threadList: InboxDesktopThreadListProps;
  messagePane: InboxDesktopMessagePaneProps;
  layout: InboxDesktopLayoutOptions;
  composerPanel: InboxDesktopComposerPanelProps;
}

export function InboxDesktopLayout({
  threadList,
  messagePane,
  layout,
  composerPanel,
}: InboxDesktopLayoutProps) {
  const {
    threads,
    displayThreads,
    threadsError,
    threadsLoadingOrNoAccount,
    showThreadSkeleton,
    threadSearchQuery,
    setThreadSearchQuery,
    filterButtonRef,
    onFilterPress,
    hasActiveFilters,
    refreshing,
    onRefresh,
    loadMoreThreads,
    hasMoreThreads,
    loadingMoreThreads,
    leadDisplayNamesMap,
    campaigns,
    threadSnippetsMap,
    threadTagsMap,
    onSelectThread,
    selectedThreadId,
    onRetryLoadThreads,
    scrollPaddingBottom,
  } = threadList;

  const {
    selectedThread,
    displayMessages,
    messagesError,
    showMessagesSkeleton,
    loadMessages,
    selectedThreadProspectEmails,
    blockedProspectEmails,
    accountId,
    onBlock,
    onOpenTagsPanel,
    onSetCategory,
    messagesScrollViewRef,
    onContentSizeChange,
    onReply,
    onForward,
    onDownloadAttachment,
    onFetchAttachmentPreview,
    pendingReply,
    onRetryFailedReply,
  } = messagePane;

  const { slideAnim, replyPanelWidth } = layout;
  const { composerMode, closeComposerPanel, composerFormProps } = composerPanel;

  const showLoading = threadsLoadingOrNoAccount || showThreadSkeleton;

  return (
    <View className="flex-1 flex-row bg-[#121212]">
      <View style={{ flex: 1, minWidth: 0 }} className="flex-row">
        <Animated.View
          className="border-r border-[#2A2A2A] bg-[#0D0D0D]"
          style={{
            width: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 384] }),
            overflow: 'hidden',
            borderRightWidth: 1,
          }}
        >
          <InboxThreadList
            threads={threads}
            displayThreads={displayThreads}
            threadsError={threadsError}
            threadsLoadingOrNoAccount={threadsLoadingOrNoAccount}
            showThreadSkeleton={showThreadSkeleton}
            threadSearchQuery={threadSearchQuery}
            setThreadSearchQuery={setThreadSearchQuery}
            filterButtonRef={filterButtonRef}
            onFilterPress={onFilterPress}
            hasActiveFilters={hasActiveFilters}
            refreshing={refreshing}
            onRefresh={onRefresh}
            loadMoreThreads={loadMoreThreads}
            hasMoreThreads={hasMoreThreads}
            loadingMoreThreads={loadingMoreThreads}
            leadDisplayNamesMap={leadDisplayNamesMap}
            campaigns={campaigns}
            threadSnippetsMap={threadSnippetsMap}
            threadTagsMap={threadTagsMap}
            onSelectThread={onSelectThread}
            selectedThreadId={selectedThreadId}
            onRetryLoadThreads={onRetryLoadThreads}
            scrollPaddingBottom={scrollPaddingBottom}
          />
        </Animated.View>

        <View className="flex-1">
          {showLoading ? (
            <>
              <MessagePanelHeaderSkeleton />
              <MessageListSkeleton />
            </>
          ) : selectedThread ? (
            <InboxMessageList
              selectedThread={selectedThread}
              displayMessages={displayMessages}
              messagesError={messagesError}
              showMessagesSkeleton={showMessagesSkeleton}
              selectedThreadId={selectedThreadId}
              loadMessages={loadMessages}
              leadDisplayNamesMap={leadDisplayNamesMap}
              campaigns={campaigns}
              threadTagsMap={threadTagsMap}
              selectedThreadProspectEmails={selectedThreadProspectEmails}
              blockedProspectEmails={blockedProspectEmails}
              onBlock={onBlock}
              accountId={accountId}
              onOpenTagsPanel={onOpenTagsPanel}
              category={selectedThread?.category ?? null}
              onSetCategory={onSetCategory}
              categoryOptions={THREAD_CATEGORIES}
              showToolbar={true}
              messagesScrollViewRef={messagesScrollViewRef}
              onContentSizeChange={onContentSizeChange}
              contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 }}
              onReply={onReply}
              onForward={onForward}
              onDownloadAttachment={onDownloadAttachment}
              onFetchAttachmentPreview={onFetchAttachmentPreview}
              pendingReply={pendingReply}
              onRetryFailedReply={onRetryFailedReply}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-8">
              <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 max-w-sm w-full items-center">
                <Text className="text-white font-instrument-semibold text-xl mb-2 text-center">
                  Select a conversation
                </Text>
                <Text className="text-gray-400 font-instrument text-center">
                  Choose a thread from the list to view messages and reply.
                </Text>
              </View>
            </View>
          )}
        </View>

        {composerMode && (
          <InboxComposerPanel
            variant="panel"
            onClose={closeComposerPanel}
            slideAnim={slideAnim}
            panelWidth={replyPanelWidth}
            mode={composerMode}
            {...composerFormProps}
          />
        )}
      </View>
    </View>
  );
}
