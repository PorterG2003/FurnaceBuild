import React, { useMemo, type ReactNode, type RefObject } from 'react';
import { View, ScrollView } from 'react-native';
import { Alert } from '@/components/ui/feedback';
import { buildInboxThreadToolbarActions } from '@/lib/inbox';
import { DateDivider } from './DateDivider';
import { MessageBubble, type MessageBubbleActionsLayout } from './MessageBubble';
import { BlockedThreadCallout } from './BlockedThreadCallout';
import { SmartHandlingCalloutSlot } from './SmartHandlingCalloutSlot';
import { MessagePanelHeader } from './MessagePanelHeader';
import { MessageListSkeleton } from './MessageListSkeleton';
import { groupMessagesByDate } from '@/lib/inbox';
import type { SmartHandlingActionOption, SmartHandlingMode } from '@/lib/inbox/smartHandling';
import type { ThreadStatusCalloutView } from '@/lib/inbox/threadStatusCallout';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { EmailThread, EmailMessage } from '@/lib/supabase/types';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { Campaign } from '@/lib/supabase/types';

export type PendingReplyInfo = {
  kind: 'reply' | 'forward' | 'campaign_reply';
  threadId: string;
  jobId: string;
  isFailed?: boolean;
  errorMessage?: string | null;
  jobStatus: 'queued' | 'reserved' | 'sending' | 'failed';
  scheduledAt: string | null;
  sendWaitReason: string | null;
  isSendingImmediately?: boolean;
  campaignName?: string | null;
};

export type ThreadStatusCalloutProps = ThreadStatusCalloutView & {
  mode: SmartHandlingMode;
  onAction?: (action: SmartHandlingActionOption) => void;
  onDismiss?: () => void;
};

export interface InboxMessageListProps {
  selectedThread: EmailThread | null;
  displayMessages: EmailMessage[];
  messagesError: string | null;
  showMessagesSkeleton: boolean;
  selectedThreadId: string | null;
  loadMessages: (threadId: string) => void;
  leadDisplayNamesMap: Record<string, string>;
  campaigns: Campaign[];
  threadTagsMap: Record<string, ThreadTag[]>;
  selectedThreadProspectEmails: string[];
  blockedProspectEmails: Set<string>;
  leadReplacementSummary?: LeadReplacementSummary | null;
  onBlock: (() => void) | undefined;
  onMarkOutOfOffice?: (() => void) | undefined;
  onReplaceLead?: (() => void) | undefined;
  onCloseConversation?: (() => void) | undefined;
  onOpenConversation?: (() => void) | undefined;
  onOpenLeadDetail?: (() => void) | undefined;
  accountId: string | null;
  onOpenTagsPanel: (() => void) | undefined;
  category: string | null;
  onSetCategory: ((category: string | null) => Promise<void>) | undefined;
  categoryOptions: readonly string[];
  showToolbar: boolean;
  /** When false, header does not show title/email (e.g. when parent shows them). Default true. */
  showTitleAndEmail?: boolean;
  /** Optional header rendered at top of scroll content (scrolls with messages, not sticky). */
  listHeaderComponent?: ReactNode;
  messagesScrollViewRef: RefObject<ScrollView | null>;
  onContentSizeChange: (width: number, height: number) => void;
  contentContainerStyle: { paddingHorizontal: number; paddingTop: number; paddingBottom: number };
  onReply: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  /** Mobile: use overflow sheet + three-dots instead of inline Reply/Forward on each bubble. */
  messageActionsLayout?: MessageBubbleActionsLayout;
  onDownloadAttachment: ((emailMessageId: string, part: string, filename: string) => Promise<void>) | undefined;
  onFetchAttachmentPreview: ((emailMessageId: string, part: string) => Promise<Blob | null>) | undefined;
  pendingReplies: PendingReplyInfo[];
  onRetryFailedReply: (jobId: string) => void;
  onSendImmediately: (jobId: string) => void;
  onCancelPendingOutbound: (jobId: string) => void;
  threadStatusCallout?: ThreadStatusCalloutProps | null;
}

export function InboxMessageList({
  selectedThread,
  displayMessages,
  messagesError,
  showMessagesSkeleton,
  selectedThreadId,
  loadMessages,
  leadDisplayNamesMap,
  campaigns,
  threadTagsMap,
  selectedThreadProspectEmails,
  blockedProspectEmails,
  leadReplacementSummary,
  onBlock,
  onMarkOutOfOffice,
  onReplaceLead,
  onCloseConversation,
  onOpenConversation,
  onOpenLeadDetail,
  accountId,
  onOpenTagsPanel,
  category,
  onSetCategory,
  categoryOptions,
  showToolbar,
  showTitleAndEmail = true,
  listHeaderComponent,
  messagesScrollViewRef,
  onContentSizeChange,
  contentContainerStyle,
  onReply,
  onForward,
  messageActionsLayout = 'inline',
  onDownloadAttachment,
  onFetchAttachmentPreview,
  pendingReplies,
  onRetryFailedReply,
  onSendImmediately,
  onCancelPendingOutbound,
  threadStatusCallout,
}: InboxMessageListProps) {
  const pendingByJobId = useMemo(() => {
    const map = new Map<string, PendingReplyInfo>();
    for (const p of pendingReplies) {
      map.set(p.jobId, p);
    }
    return map;
  }, [pendingReplies]);

  const hasBlocked = useMemo(
    () => selectedThreadProspectEmails.some((e) => blockedProspectEmails.has(e.trim().toLowerCase())),
    [selectedThreadProspectEmails, blockedProspectEmails]
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
        showCloseConversationButton: selectedThread?.conversation_status !== 'closed',
        onCloseConversation,
        showOpenConversationButton: selectedThread?.conversation_status === 'closed',
        onOpenConversation,
        onOpenTagsPanel,
        tagCount: selectedThreadId ? (threadTagsMap[selectedThreadId] ?? []).length : 0,
      }),
    [
      accountId,
      onBlock,
      onCloseConversation,
      onMarkOutOfOffice,
      onOpenConversation,
      onOpenTagsPanel,
      onReplaceLead,
      selectedThread?.lead_id,
      selectedThread?.conversation_status,
      selectedThreadId,
      selectedThreadProspectEmails.length,
      threadTagsMap,
    ],
  );

  const messageColumnNarrow = messageActionsLayout !== 'overflowSheet';

  if (!selectedThread) return null;

  return (
    <>
      <MessagePanelHeader
        prospectName={
          (selectedThread.lead_id && leadDisplayNamesMap[selectedThread.lead_id]) ||
          selectedThreadProspectEmails[0] ||
          null
        }
        campaignName={
          selectedThread.campaign_id
            ? campaigns.find((c) => c.id === selectedThread.campaign_id)?.name ?? null
            : null
        }
        sourceLabel={selectedThread.smartlead_lead_id != null ? 'Imported from Smartlead' : null}
        prospectEmails={selectedThreadProspectEmails}
        blockedEmails={blockedProspectEmails}
        toolbarActions={toolbarActions}
        category={category}
        onSetCategory={onSetCategory}
        categoryOptions={[...categoryOptions]}
        showToolbar={showToolbar}
        showTitleAndEmail={showTitleAndEmail}
        replacementSummary={leadReplacementSummary}
        onOpenLeadDetail={onOpenLeadDetail}
      />
      {messagesError && (
        <View className="p-4">
          <Alert
            variant="error"
            message={messagesError}
            actionText="Retry"
            onAction={() => selectedThreadId && loadMessages(selectedThreadId)}
          />
        </View>
      )}
      {showMessagesSkeleton ? (
        <MessageListSkeleton variant={messageActionsLayout === 'overflowSheet' ? 'mobile' : 'desktop'} />
      ) : (
        <ScrollView
          ref={messagesScrollViewRef}
          onContentSizeChange={onContentSizeChange}
          className="flex-1 bg-[#121212]"
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
        >
          {listHeaderComponent}
          <View className="w-full">
            {hasBlocked ? (
              messageColumnNarrow ? (
                <View className="mb-4 flex-row w-full justify-center items-start">
                  <View className="w-[92%] max-w-[92%]">
                    <BlockedThreadCallout />
                  </View>
                </View>
              ) : (
                <View className="mb-4 w-full">
                  <BlockedThreadCallout />
                </View>
              )
            ) : null}
            {groupMessagesByDate(displayMessages).map((group) => (
              <View key={group.label}>
                <DateDivider label={group.label} />
                {group.messages.map((message) => {
                  const isPendingMessage = message.id.startsWith('pending-');
                  const pendingJobId = isPendingMessage
                    ? message.id.slice('pending-'.length)
                    : null;
                  const pendingInfo =
                    pendingJobId && selectedThreadId
                      ? pendingByJobId.get(pendingJobId) ?? null
                      : null;
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      messageActionsLayout={messageActionsLayout}
                      onReply={onReply}
                      onForward={onForward}
                      onDownloadAttachment={onDownloadAttachment}
                      onFetchAttachmentPreview={onFetchAttachmentPreview}
                      isPending={isPendingMessage && !pendingInfo?.isFailed}
                      isFailed={pendingInfo?.isFailed ?? false}
                      errorMessage={pendingInfo?.errorMessage}
                      pendingJobStatus={
                        pendingInfo?.jobStatus === 'failed' ? undefined : pendingInfo?.jobStatus
                      }
                      pendingScheduledAt={pendingInfo?.scheduledAt}
                      pendingSendWaitReason={pendingInfo?.sendWaitReason}
                      isSendingImmediately={pendingInfo?.isSendingImmediately}
                      onSendImmediately={
                        pendingInfo && !pendingInfo.isFailed
                          ? () => onSendImmediately(pendingInfo.jobId)
                          : undefined
                      }
                      onCancel={
                        pendingInfo &&
                        ((pendingInfo.jobStatus === 'queued' && !pendingInfo.isFailed) || pendingInfo.isFailed)
                          ? () => onCancelPendingOutbound(pendingInfo.jobId)
                          : undefined
                      }
                      pendingDisplayLabel={
                        pendingInfo?.kind === 'campaign_reply'
                          ? 'Campaign reply'
                          : pendingInfo?.kind === 'forward'
                            ? 'Forward'
                            : undefined
                      }
                      pendingSecondaryLabel={
                        pendingInfo?.kind === 'campaign_reply'
                          ? pendingInfo.campaignName ?? null
                          : pendingInfo?.kind === 'forward'
                            ? message.to_email
                            : undefined
                      }
                      cancelLabel={
                        pendingInfo?.kind === 'campaign_reply'
                          ? 'Cancel scheduled reply'
                          : 'Cancel send'
                      }
                      cancelConfirmTitle={
                        pendingInfo?.kind === 'campaign_reply'
                          ? 'Cancel automated reply?'
                          : 'Discard this message?'
                      }
                      cancelConfirmMessage={
                        pendingInfo?.kind === 'campaign_reply'
                          ? 'This will stop the automated reply from sending and let you take over manually.'
                          : 'This will cancel the pending manual message before it sends.'
                      }
                      onRetry={
                        pendingInfo?.isFailed && pendingInfo.kind === 'reply' && pendingJobId
                          ? () => onRetryFailedReply(pendingJobId)
                          : undefined
                      }
                    />
                  );
                })}
              </View>
            ))}
            <SmartHandlingCalloutSlot
              callout={threadStatusCallout ?? null}
              selectedThreadId={selectedThreadId}
              messageColumnNarrow={messageColumnNarrow}
            />
          </View>
        </ScrollView>
      )}
    </>
  );
}
