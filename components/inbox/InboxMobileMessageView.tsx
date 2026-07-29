import React, { type RefObject } from 'react';
import { View } from 'react-native';
import { DetailPageHeader } from '@/components/ui/layout';
import { MobileHeaderButton } from '@/components/ui/MobileHeaderButton';
import { useOnboardingTarget } from '@/components/onboarding/useOnboardingTarget';
import { TARGETS } from '@/lib/onboarding/types';
import { BlockedBadge } from './BlockedBadge';
import { MessageListSkeleton, type MessageListSkeletonProps } from './MessageListSkeleton';
import { InboxMessageList } from './InboxMessageList';
import { THREAD_CATEGORIES } from './inboxConstants';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { Campaign } from '@/lib/supabase/types';
import type { PendingReplyInfo, ThreadStatusCalloutProps } from './InboxMessageList';

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
  onCloseConversation?: (() => void) | undefined;
  onOpenConversation?: (() => void) | undefined;
  onOpenLeadDetail?: (() => void) | undefined;
  onOpenTagsPanel: (() => void) | undefined;
  category: string | null;
  onSetCategory: (category: string | null) => Promise<void>;
  messagesScrollViewRef: RefObject<import('react-native').ScrollView | null>;
  onContentSizeChange: (width: number, height: number) => void;
  onReply: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  onDownloadAttachment: ((emailMessageId: string, attachmentIndex: number, filename: string) => Promise<void>) | undefined;
  onFetchAttachmentPreview: ((emailMessageId: string, attachmentIndex: number) => Promise<Blob | null>) | undefined;
  pendingReplies: PendingReplyInfo[];
  onRetryFailedReply: (jobId: string) => void;
  onSendImmediately: (jobId: string) => void;
  onCancelPendingOutbound: (jobId: string) => void;
  threadStatusCallout?: ThreadStatusCalloutProps | null;
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
    onCloseConversation,
    onOpenConversation,
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
    onCancelPendingOutbound,
    threadStatusCallout,
  } = messagePane;

  const { mobileMessageViewTitle, onBack, onOpenMessageActions } = mobile;

  const leadDetailRef = useOnboardingTarget(TARGETS.inboxLeadDetail);
  const mobileActionsRef = useOnboardingTarget(TARGETS.inboxMobileActions);

  const mobileMessageListSkeletonProps = { variant: 'mobile' as const } satisfies MessageListSkeletonProps;

  const subtitleEmail = selectedThreadProspectEmails[0] ?? selectedThreadRecipientEmail ?? null;
  const subtitleBlocked =
    !!subtitleEmail && blockedProspectEmails.has(subtitleEmail.trim().toLowerCase());

  const header = (
    <DetailPageHeader
      breadcrumbItems={[{ label: 'Inbox', href: '/inbox' }, { label: mobileMessageViewTitle ?? 'Conversation' }]}
      backHref="/inbox"
      title={mobileMessageViewTitle ?? 'Conversation'}
      subtitle={subtitleEmail}
      subtitleAddon={subtitleBlocked ? <BlockedBadge /> : null}
      onBack={onBack}
      onTitlePress={onOpenLeadDetail}
      titleRef={leadDetailRef}
      mobileRightAction={
        selectedThread ? (
          <View ref={mobileActionsRef} collapsable={false}>
            <MobileHeaderButton
              variant="actions"
              onPress={onOpenMessageActions}
              accessibilityLabel="Message actions"
            />
          </View>
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
      onCloseConversation={onCloseConversation}
      onOpenConversation={onOpenConversation}
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
      onCancelPendingOutbound={onCancelPendingOutbound}
      threadStatusCallout={threadStatusCallout}
    />
  );
}
