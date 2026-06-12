import React, { type RefObject } from 'react';
import { DetailPageHeader } from '@/components/ui/layout';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { MessageListSkeleton, type MessageListSkeletonProps } from './MessageListSkeleton';
import { InboxMessageList } from './InboxMessageList';
import { THREAD_CATEGORIES } from './inboxConstants';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { Campaign } from '@/lib/supabase/types';
import type { PendingReplyInfo } from './InboxMessageList';

export interface InboxMobileMessagePaneProps {
  showMessagePaneSkeleton: boolean;
  showMessageBodySkeleton: boolean;
  selectedThread: EmailThread | null;
  displayMessages: EmailMessage[];
  messagesError: string | null;
  selectedThreadId: string | null;
  loadMessages: (threadId: string, options?: { silent?: boolean }) => void;
  leadDisplayNamesMap: Record<string, string>;
  campaigns: Campaign[];
  threadTagsMap: Record<string, ThreadTag[]>;
  selectedThreadProspectEmails: string[];
  selectedThreadRecipientEmail?: string | null;
  blockedProspectEmails: Set<string>;
  leadReplacementSummary?: LeadReplacementSummary | null;
  accountId: string | null;
  onBlock: (() => void) | undefined;
  onMarkOutOfOffice?: (() => void) | undefined;
  onReplaceLead?: (() => void) | undefined;
  onOpenLeadDetail?: (() => void) | undefined;
  onOpenTagsPanel: (() => void) | undefined;
  category: string | null;
  onSetCategory: (category: string | null) => Promise<void>;
  messagesScrollViewRef: RefObject<import('react-native').ScrollView | null>;
  onContentSizeChange: (width: number, height: number) => void;
  onReply: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  onDownloadAttachment: ((emailMessageId: string, part: string, filename: string) => Promise<void>) | undefined;
  onFetchAttachmentPreview: ((emailMessageId: string, part: string) => Promise<Blob | null>) | undefined;
  pendingReplies: PendingReplyInfo[];
  onRetryFailedReply: (jobId: string) => void;
  onSendImmediately: (jobId: string) => void;
}

export interface InboxMobileMessageViewMobileProps {
  mobileMessageViewTitle: string | null;
  onBack: () => void;
  onOpenMessageActions: () => void;
}

export interface InboxMobileMessageViewProps {
  messagePane: InboxMobileMessagePaneProps;
  mobile: InboxMobileMessageViewMobileProps;
}

export function InboxMobileMessageView({ messagePane, mobile }: InboxMobileMessageViewProps) {
  const {
    showMessagePaneSkeleton,
    showMessageBodySkeleton,
    selectedThread,
    displayMessages,
    messagesError,
    selectedThreadId,
    loadMessages,
    leadDisplayNamesMap,
    campaigns,
    threadTagsMap,
    selectedThreadProspectEmails,
    selectedThreadRecipientEmail,
    blockedProspectEmails,
    leadReplacementSummary,
    accountId,
    onBlock,
    onMarkOutOfOffice,
    onReplaceLead,
    onOpenLeadDetail,
    onOpenTagsPanel,
    category,
    onSetCategory,
    messagesScrollViewRef,
    onContentSizeChange,
    onReply,
    onForward,
    onDownloadAttachment,
    onFetchAttachmentPreview,
    pendingReplies,
    onRetryFailedReply,
    onSendImmediately,
  } = messagePane;

  const { mobileMessageViewTitle, onBack, onOpenMessageActions } = mobile;

  const mobileMessageListSkeletonProps = { variant: 'mobile' as const } satisfies MessageListSkeletonProps;

  const header = (
    <DetailPageHeader
      breadcrumbItems={[{ label: 'Inbox', href: '/inbox' }, { label: mobileMessageViewTitle ?? 'Conversation' }]}
      backHref="/inbox"
      title={mobileMessageViewTitle ?? 'Conversation'}
      subtitle={selectedThreadProspectEmails[0] ?? selectedThreadRecipientEmail ?? null}
      onBack={onBack}
      onTitlePress={onOpenLeadDetail}
      mobileRightAction={
        selectedThread ? (
          <MobileHeaderButton
            variant="actions"
            onPress={onOpenMessageActions}
            accessibilityLabel="Message actions"
          />
        ) : undefined
      }
    />
  );

  if (showMessagePaneSkeleton) {
    return (
      <>
        {header}
        <MessageListSkeleton {...mobileMessageListSkeletonProps} />
      </>
    );
  }

  if (!selectedThread) return null;

  return (
    <InboxMessageList
      selectedThread={selectedThread}
      displayMessages={displayMessages}
      messagesError={messagesError}
      showMessagesSkeleton={showMessageBodySkeleton}
      selectedThreadId={selectedThreadId}
      loadMessages={loadMessages}
      leadDisplayNamesMap={leadDisplayNamesMap}
      campaigns={campaigns}
      threadTagsMap={threadTagsMap}
      selectedThreadProspectEmails={selectedThreadProspectEmails}
      blockedProspectEmails={blockedProspectEmails}
      leadReplacementSummary={leadReplacementSummary}
      onBlock={onBlock}
      onMarkOutOfOffice={onMarkOutOfOffice}
      onReplaceLead={onReplaceLead}
      onOpenLeadDetail={onOpenLeadDetail}
      accountId={accountId}
      onOpenTagsPanel={onOpenTagsPanel}
      category={category}
      onSetCategory={onSetCategory}
      categoryOptions={THREAD_CATEGORIES}
      showToolbar={false}
      showTitleAndEmail={false}
      listHeaderComponent={header}
      messagesScrollViewRef={messagesScrollViewRef}
      onContentSizeChange={onContentSizeChange}
      contentContainerStyle={{
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
      }}
      onReply={onReply}
      onForward={onForward}
      messageActionsLayout="overflowSheet"
      onDownloadAttachment={onDownloadAttachment}
      onFetchAttachmentPreview={onFetchAttachmentPreview}
      pendingReplies={pendingReplies}
      onRetryFailedReply={onRetryFailedReply}
      onSendImmediately={onSendImmediately}
    />
  );
}
