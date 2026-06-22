import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { useToast } from '@/components/ui/feedback';
import { PageLayout, LAYOUT_BREAKPOINT, BOTTOM_NAV_SCROLL_PADDING } from '@/components/ui/layout';
import { openLeadDetail } from '@/lib/leads/navigation';
import {
  addTagToThread,
  removeTagFromThread,
} from '@/lib/supabase/services';
import { fetchAttachment } from '@/lib/services/attachments';
import { getAccessToken } from '@/lib/services/auth-token';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { EmailMessage } from '@/lib/supabase/types';
import { InboxComposerPanel } from './InboxComposerPanel';
import { InboxDesktopLayout } from './InboxDesktopLayout';
import { InboxMobileMessageView } from './InboxMobileMessageView';
import { InboxModals } from './InboxModals';
import { InboxThreadList } from './InboxThreadList';
import { MarkOutOfOfficeModal } from './MarkOutOfOfficeModal';
import { ReplaceLeadModal } from './ReplaceLeadModal';
import { getDisplayBody } from '@/lib/email/index';
import { resolveThreadCardTitle, resolveThreadRecipientEmail } from '@/lib/inbox';
import { buildReplaceLeadPrefill } from '@/lib/inbox/replaceLeadPrefill';
import { parseOutOfOfficeReturnDate } from '@/lib/inbox/parseOutOfOfficeReturnDate';
import { parseSmartHandlingMetadata } from '@/lib/inbox/smartHandling';
import { resolveThreadStatusCallout } from '@/lib/inbox/threadStatusCallout';
import { closeConversation, reopenConversation, updateThreadCategory } from '@/lib/supabase/services';
import {
  buildInboxInternalThreadHref,
  buildInboxListHref,
  buildInboxThreadHref,
  canUseInternalInboxRouteAccess,
  cleanInboxThreadUrlOnWeb,
  normalizeRouteParam,
} from '@/lib/inbox/inboxRoutes';
import { format } from 'date-fns';
import { useInboxData } from '@/hooks/useInboxData';
import { useInboxLoadingPolicy } from '@/hooks/useInboxLoadingPolicy';
import { useInboxRouteAccess } from '@/hooks/useInboxRouteAccess';
import { useInboxComposer } from '@/hooks/useInboxComposer';
import { useInboxFilterUI } from '@/hooks/useInboxFilterUI';
import { useInboxThreadActions } from '@/hooks/useInboxThreadActions';
import outputs from '@/amplify_outputs.json';

const FETCH_ATTACHMENT_URL = (outputs as { custom?: { fetchEmailAttachmentUrl?: string } }).custom?.fetchEmailAttachmentUrl;

export interface InboxScreenProps {
  routeThreadId: string | null;
}

export function InboxScreen({ routeThreadId }: InboxScreenProps) {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{
    thread?: string | string[];
  }>();
  const { account, memberships, setCurrentAccountId, initialized, loading: accountLoading } = useAccount();
  const { toast } = useToast();
  const accountId = account?.id ?? null;
  const membershipAccountIds = useMemo(
    () => memberships.map((m) => m.account.id),
    [memberships]
  );

  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isMobile = winWidth < LAYOUT_BREAKPOINT;

  const legacyRedirectDoneRef = useRef(false);
  const internalNavigationRef = useRef(false);
  const loadedThreadIdsRef = useRef<string[]>([]);
  const loadedForAccountIdRef = useRef<string | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const stickySelectedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    cleanInboxThreadUrlOnWeb(
      routeThreadId ? `/inbox/${encodeURIComponent(routeThreadId)}` : '/inbox'
    );
  }, [routeThreadId]);

  useEffect(() => {
    if (routeThreadId != null || legacyRedirectDoneRef.current) return;
    const legacyThread = normalizeRouteParam(searchParams.thread);
    if (!legacyThread) return;
    legacyRedirectDoneRef.current = true;
    router.replace(buildInboxThreadHref(legacyThread) as Href);
  }, [routeThreadId, searchParams.thread, router]);

  const handleRouteDenied = useCallback(
    (reason: 'not_member' | 'thread_not_found') => {
      const message =
        reason === 'not_member'
          ? 'You do not have access to that workspace.'
          : 'That conversation could not be found.';
      toast.error(message);
    },
    [toast]
  );

  const routeAccess = useInboxRouteAccess({
    routeThreadId,
    currentAccountId: accountId,
    membershipAccountIds,
    accountInitialized: initialized,
    accountLoading,
    setCurrentAccountId,
    router,
    onDenied: handleRouteDenied,
    internalNavigationRef,
    loadedThreadIdsRef,
    loadedForAccountIdRef,
  });

  const trustLoadedThreadList = canUseInternalInboxRouteAccess({
    routeThreadId,
    loadedThreadIds: loadedThreadIdsRef.current,
    loadedForAccountId: loadedForAccountIdRef.current,
    currentAccountId: accountId,
  });

  const selectedThreadId = useMemo(() => {
    if (routeThreadId == null) {
      stickySelectedThreadIdRef.current = null;
      return null;
    }
    if (trustLoadedThreadList || routeAccess.status === 'ready') {
      stickySelectedThreadIdRef.current = routeThreadId;
      return routeThreadId;
    }
    if (routeAccess.status === 'loading' && stickySelectedThreadIdRef.current === routeThreadId) {
      return routeThreadId;
    }
    return null;
  }, [routeThreadId, trustLoadedThreadList, routeAccess.status]);

  const inboxData = useInboxData({
    accountId: initialized && !accountLoading ? accountId : null,
    selectedThreadId,
    routeValidatedThread: routeAccess.validatedThread,
  });
  const {
    threads,
    setThreads,
    messages,
    setMessages,
    selectedThread,
    threadsLoading,
    threadsError,
    initialThreadsLoadSettled,
    messagesLoading,
    messagesLoadedForThreadId,
    messagesError,
    refreshing,
    threadSearchQuery,
    mailboxFilterId,
    campaignFilterId,
    unreadOnlyFilter,
    datePreset,
    tagFilterIds,
    campaignTagFilterIds,
    categoryFilter,
    conversationStatusFilter,
    hasMoreThreads,
    loadingMoreThreads,
    mailboxes,
    campaigns,
    blockList,
    threadTagsMap,
    setThreadTagsMap,
    threadSnippetsMap,
    leadDisplayNamesMap,
    leadByIdMap,
    leadReplacementSummaryMap,
    accountTags,
    setAccountTags,
    accountCampaignTags,
    displayThreads,
    hasActiveFilters,
    selectedThreadProspectEmails,
    blockedProspectEmails,
    filterButtonRef,
    loadThreads,
    loadMessages,
    loadMoreThreads,
    handleRefresh,
    markThreadReadOptimistic,
    loadBlockList,
    clearAllFilters,
  } = inboxData;

  const loadingPolicy = useInboxLoadingPolicy({
    accountId,
    initialThreadsLoadPending: !!accountId && !initialThreadsLoadSettled,
    switchingAccount: routeAccess.switchingAccount,
    routeThreadId,
    selectedThreadId,
    routeAccessStatus: routeAccess.status,
    threadsLoading,
    threadCount: threads.length,
    threadsError,
    messagesLoading,
    messagesLoadedForThreadId,
    hasActiveFilters,
    refreshing,
  });

  const loadedAccountSyncRef = useRef<string | null>(accountId);
  if (loadedAccountSyncRef.current !== accountId) {
    loadedThreadIdsRef.current = [];
    loadedForAccountIdRef.current = null;
    loadedAccountSyncRef.current = accountId;
  } else {
    loadedThreadIdsRef.current = threads.map((thread) => thread.id);
    loadedForAccountIdRef.current = accountId;
  }

  useEffect(() => {
    const prev = prevAccountIdRef.current;
    prevAccountIdRef.current = accountId;
    if (!prev || !accountId || prev === accountId) return;
    if (!routeThreadId) return;
    if (routeAccess.switchingAccount) return;
    router.replace(buildInboxListHref());
  }, [accountId, routeThreadId, routeAccess.switchingAccount, router]);

  useEffect(() => {
    if (!routeAccess.shouldClearFiltersForDeepLink) return;
    clearAllFilters();
    routeAccess.consumeDeepLinkFilterClear();
  }, [routeAccess.shouldClearFiltersForDeepLink, clearAllFilters, routeAccess]);

  const navigateToInboxList = useCallback(() => {
    if (routeThreadId) {
      router.replace(buildInboxListHref());
    }
  }, [routeThreadId, router]);

  const wrapFilterChange = useCallback(
    <T,>(setter: (value: T) => void) =>
      (value: T) => {
        navigateToInboxList();
        setter(value);
      },
    [navigateToInboxList]
  );

  const setThreadSearchQuery = wrapFilterChange(inboxData.setThreadSearchQuery);
  const setMailboxFilterId = wrapFilterChange(inboxData.setMailboxFilterId);
  const setCampaignFilterId = wrapFilterChange(inboxData.setCampaignFilterId);
  const setUnreadOnlyFilter = wrapFilterChange(inboxData.setUnreadOnlyFilter);
  const setDatePreset = wrapFilterChange(inboxData.setDatePreset);
  const setTagFilterIds = wrapFilterChange(inboxData.setTagFilterIds);
  const setCampaignTagFilterIds = wrapFilterChange(inboxData.setCampaignTagFilterIds);
  const setCategoryFilter = wrapFilterChange(inboxData.setCategoryFilter);
  const setConversationStatusFilter = wrapFilterChange(inboxData.setConversationStatusFilter);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      const href = buildInboxInternalThreadHref(threadId);
      markThreadReadOptimistic(threadId);
      internalNavigationRef.current = true;
      router.replace(href as Href);
    },
    [markThreadReadOptimistic, router]
  );

  const {
    filterMenuOpen,
    setFilterMenuOpen,
    filterAnchorLayout,
    openFilterMenu,
  } = useInboxFilterUI();
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [tagsPanelVisible, setTagsPanelVisible] = useState(false);
  const [showMessageActionsSheet, setShowMessageActionsSheet] = useState(false);
  const [infoSheetVisible, setInfoSheetVisible] = useState(false);
  const [smartHandlingDismissedForCurrentView, setSmartHandlingDismissedForCurrentView] = useState(false);
  const [blockedRecipientConfirm, setBlockedRecipientConfirm] = useState<{
    mode: 'reply' | 'forward';
    onConfirm: () => void;
  } | null>(null);

  const composer = useInboxComposer({
    accountId,
    mailboxSignatureRaw: selectedThread?.mailbox_id
      ? (mailboxes.find((m) => m.id === selectedThread.mailbox_id)?.signature ?? null)
      : null,
    selectedThreadId,
    selectedThread,
    currentLeadEmail: selectedThread?.lead_id ? (leadByIdMap[selectedThread.lead_id]?.email ?? null) : null,
    currentLeadName: selectedThread?.lead_id ? (leadByIdMap[selectedThread.lead_id]?.name ?? null) : null,
    messages,
    loadMessages,
    blockList,
    toast,
    setBlockedRecipientConfirm,
    threadsLoading,
  });

  const {
    composerMode,
    replyToEmail,
    setReplyToEmail,
    replySubject,
    setReplySubject,
    replyCc,
    setReplyCc,
    forwardToEmail,
    setForwardToEmail,
    forwardCc,
    setForwardCc,
    forwardSubject,
    setForwardSubject,
    sendingReply,
    sendingForward,
    composerAttachments,
    setComposerAttachments,
    composerAttachmentsLoading,
    composerAttachmentsSkipMessage,
    pendingReplies,
    autoReplyPipelineState,
    replyDuplicateConfirm,
    setReplyDuplicateConfirm,
    includeSignature,
    setIncludeSignature,
    forwardQuoteHtml,
    replyEditorMode,
    forwardEditorMode,
    replyHtmlDraft,
    setReplyHtmlDraft,
    forwardHtmlDraft,
    setForwardHtmlDraft,
    replyRichInitialContent,
    setReplyRichInitialContent,
    forwardRichInitialContent,
    switchToRichConfirmMode,
    setSwitchToRichConfirmMode,
    composerEditorRef,
    slideAnim,
    closeComposerPanel,
    openReplyComposer,
    openForwardComposer,
    switchComposerToHtml,
    confirmSwitchComposerToRich,
    sendReply,
    sendForward,
    sendPendingImmediately,
    cancelPendingOutbound,
    retryFailedReply,
    handleComposerFilesSelected,
  } = composer;

  const messagesScrollViewRef = useRef<ScrollView>(null);
  const lastContentHeightRef = useRef(0);
  const prevMessagesLengthRef = useRef(0);
  const prevSelectedThreadIdRef = useRef<string | null>(null);
  const autoScrollArmedRef = useRef(false);
  const selectedThreadIdRef = useRef(selectedThreadId);
  selectedThreadIdRef.current = selectedThreadId;

  const displayMessages = useMemo((): EmailMessage[] => {
    if (!selectedThreadId || !selectedThread) return [];
    const threadPending = pendingReplies.filter((p) => p.threadId === selectedThreadId);
    const pendingMessages: EmailMessage[] = threadPending.map((p) => ({
      id: `pending-${p.jobId}`,
      thread_id: selectedThreadId,
      account_id: selectedThread.account_id,
      message_job_id: p.jobId,
      direction: 'sent' as const,
      from_email: p.fromEmail,
      from_name: null,
      to_email: p.toEmail,
      to_name: null,
      cc: null,
      subject: p.subject,
      body_text: p.bodyText,
      body_html: p.bodyHtml,
      message_id: null,
      in_reply_to: null,
      message_references: null,
      received_at: p.receivedAt,
      read_at: null,
      headers: {},
      attachments: [],
      imap_uid: null,
      created_at: p.receivedAt,
      updated_at: p.receivedAt,
    }));
    const base = messages.filter((m) => m.thread_id === selectedThreadId);
    if (pendingMessages.length === 0) {
      return base;
    }
    return [...base, ...pendingMessages].sort(
      (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
    );
  }, [selectedThreadId, selectedThread, messages, pendingReplies]);

  const latestReceivedInbound = useMemo(() => {
    const received = messages.filter((m) => m.direction === 'received');
    if (received.length === 0) return null;
    return [...received].sort(
      (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
    )[0];
  }, [messages]);

  const selectedThreadReplacementSummary = selectedThread?.lead_id
    ? (leadReplacementSummaryMap[selectedThread.lead_id] ?? null)
    : null;

  const selectedThreadCampaignName = useMemo(() => {
    if (!selectedThread?.campaign_id) return null;
    return campaigns.find((c) => c.id === selectedThread.campaign_id)?.name ?? null;
  }, [campaigns, selectedThread?.campaign_id]);

  const leadEmailById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [leadId, lead] of Object.entries(leadByIdMap)) {
      const email = lead.email?.trim();
      if (email) map[leadId] = email;
    }
    return map;
  }, [leadByIdMap]);

  const mailboxEmailById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const mailbox of mailboxes) {
      const email = mailbox.email_address?.trim();
      if (email) map[mailbox.id] = email;
    }
    return map;
  }, [mailboxes]);

  const oooPrefillYmd = useMemo(() => {
    const ref = latestReceivedInbound
      ? new Date(latestReceivedInbound.received_at)
      : new Date();
    if (!latestReceivedInbound) {
      return null as string | null;
    }
    const rawBody =
      latestReceivedInbound.body_text ?? latestReceivedInbound.body_html ?? '';
    const body = getDisplayBody(rawBody, {
      format: latestReceivedInbound.body_text ? 'text' : 'html',
    });
    const parsed = parseOutOfOfficeReturnDate(body, ref);
    return parsed ? format(parsed, 'yyyy-MM-dd') : null;
  }, [latestReceivedInbound]);

  const smartHandlingMetadata = useMemo(
    () => parseSmartHandlingMetadata(selectedThread?.handling_metadata ?? null),
    [selectedThread?.handling_metadata]
  );
  const replaceLeadPrefill = useMemo(() => {
    const oldLead = selectedThread?.lead_id ? leadByIdMap[selectedThread.lead_id] : null;
    const customLeadData =
      oldLead?.custom_lead_data &&
      typeof oldLead.custom_lead_data === 'object' &&
      !Array.isArray(oldLead.custom_lead_data)
        ? Object.keys(oldLead.custom_lead_data as Record<string, unknown>)
        : [];

    return buildReplaceLeadPrefill({
      metadata: smartHandlingMetadata,
      inboundFromEmail: latestReceivedInbound?.from_email,
      inboundFromName: latestReceivedInbound?.from_name,
      customLeadDataKeys: customLeadData,
    });
  }, [
    leadByIdMap,
    latestReceivedInbound?.from_email,
    latestReceivedInbound?.from_name,
    selectedThread?.lead_id,
    smartHandlingMetadata,
  ]);

  const dismissSmartHandling = useCallback(() => {
    setSmartHandlingDismissedForCurrentView(true);
  }, []);

  const buildSuggestedReplyHtml = useCallback((value: string) => {
    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<p>${escaped.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`;
  }, []);

  const handleSetThreadCategory = useCallback(
    async (cat: string | null) => {
      if (!selectedThreadId || !accountId) return;
      try {
        await updateThreadCategory(selectedThreadId, cat);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === selectedThreadId
              ? {
                  ...t,
                  category: cat,
                  category_source: cat ? 'user' : null,
                }
              : t,
          )
        );
      } catch (e) {
        console.error('Failed to update category:', e);
        toast.error(e instanceof Error ? e.message : 'Failed to update category.');
      }
    },
    [selectedThreadId, accountId, setThreads, toast]
  );

  const threadActions = useInboxThreadActions({
    accountId,
    selectedThreadId,
    selectedThread,
    isMobile,
    router,
    smartHandlingMetadata,
    selectedThreadProspectEmails,
    latestReceivedInbound,
    messages,
    setThreads,
    loadThreads,
    loadMessages,
    loadBlockList,
    setCategory: handleSetThreadCategory,
    openReplyComposer,
    openForwardComposer,
    setReplyHtmlDraft,
    setReplyRichInitialContent,
    buildSuggestedReplyHtml,
    dismissSmartHandling,
    toast,
  });

  const closeSelectedConversation = useCallback(
    async (source: 'user' | 'system' = 'user') => {
      if (!selectedThreadId) return;
      await closeConversation(selectedThreadId, source);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === selectedThreadId
            ? {
                ...thread,
                conversation_status: 'closed',
                conversation_status_source: source,
              }
            : thread,
        ),
      );
    },
    [selectedThreadId, setThreads]
  );

  const openSelectedConversation = useCallback(
    async (source: 'user' | 'system' = 'user') => {
      if (!selectedThreadId) return;
      await reopenConversation(selectedThreadId, source);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === selectedThreadId
            ? {
                ...thread,
                conversation_status: 'open',
                conversation_status_source: source,
              }
            : thread,
        ),
      );
    },
    [selectedThreadId, setThreads]
  );

  const scrollMessagesToEnd = useCallback((reason: string, nextHeight?: number) => {
    if (typeof nextHeight === 'number') {
      lastContentHeightRef.current = nextHeight;
    }
    messagesScrollViewRef.current?.scrollToEnd({ animated: true });
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const shouldAutoScroll = autoScrollArmedRef.current;
    if (shouldAutoScroll) {
      autoScrollArmedRef.current = false;
      scrollMessagesToEnd('content-size-change', h);
      return;
    }
    if (lastContentHeightRef.current !== h) {
      lastContentHeightRef.current = h;
    }
  }, [scrollMessagesToEnd]);

  const effectiveOooPrefillYmd =
    threadActions.oooModalPrefillOverride !== undefined
      ? threadActions.oooModalPrefillOverride
      : oooPrefillYmd;

  const openLeadDetailFromInbox = useCallback(() => {
    if (!selectedThread?.lead_id) return;
    const lead = leadByIdMap[selectedThread.lead_id];
    void openLeadDetail(router, {
      globalLeadId: lead?.global_lead_id ?? undefined,
      leadId: selectedThread.lead_id,
      campaignId: selectedThread.campaign_id ?? undefined,
      campaignName: selectedThreadCampaignName ?? undefined,
      from: 'inbox',
      threadId: selectedThreadId ?? undefined,
    });
  }, [
    leadByIdMap,
    router,
    selectedThread?.campaign_id,
    selectedThread?.lead_id,
    selectedThreadCampaignName,
    selectedThreadId,
  ]);

  useEffect(() => {
    if (showMessageActionsSheet) {
      threadActions.clearQueuedOpen();
    }
  }, [showMessageActionsSheet, threadActions.clearQueuedOpen]);

  useEffect(() => {
    setSmartHandlingDismissedForCurrentView(false);
  }, [selectedThreadId]);

  const threadStatusCalloutView = useMemo(() => {
    if (!selectedThreadId || !selectedThread) return null;

    const resolved = resolveThreadStatusCallout({
      conversationStatus: selectedThread.conversation_status,
      classificationStatus: selectedThread.classification_status,
      category: selectedThread.category,
      categorySource: selectedThread.category_source,
      handlingMetadata: smartHandlingMetadata,
      pipelineState: autoReplyPipelineState,
      dismissedForCurrentView: smartHandlingDismissedForCurrentView,
    });

    if (!resolved) return null;

    return {
      ...resolved,
      onAction: resolved.kind === 'manual_actions' ? threadActions.runFromSmartHandling : undefined,
      onDismiss: resolved.dismissible ? () => dismissSmartHandling() : undefined,
    };
  }, [
    autoReplyPipelineState,
    dismissSmartHandling,
    threadActions.runFromSmartHandling,
    selectedThread,
    selectedThreadId,
    smartHandlingDismissedForCurrentView,
    smartHandlingMetadata,
  ]);

  const handleTagCreated = useCallback(
    async (tag: ThreadTag) => {
      setAccountTags((p) => (p.some((t) => t.id === tag.id) ? p : [...p, tag]));
      if (selectedThreadId) {
        try {
          await addTagToThread(selectedThreadId, tag.id);
          setThreadTagsMap((prev) => ({
            ...prev,
            [selectedThreadId]: [...(prev[selectedThreadId] ?? []), tag],
          }));
        } catch (e) {
          console.error('Failed to add tag to thread:', e);
        }
      }
    },
    [selectedThreadId, setAccountTags, setThreadTagsMap]
  );

  const handleAddTagToSelectedThread = useCallback(
    async (tag: ThreadTag) => {
      if (!selectedThreadId) return;
      try {
        await addTagToThread(selectedThreadId, tag.id);
        setThreadTagsMap((prev) => ({
          ...prev,
          [selectedThreadId]: [...(prev[selectedThreadId] ?? []), tag],
        }));
        if (!accountTags.some((t) => t.id === tag.id)) {
          setAccountTags((p) => [...p, tag]);
        }
      } catch (e) {
        console.error('Failed to add tag to thread:', e);
      }
    },
    [selectedThreadId, accountTags, setThreadTagsMap, setAccountTags]
  );

  const handleRemoveTagFromSelectedThread = useCallback(
    async (tag: ThreadTag) => {
      if (!selectedThreadId) return;
      try {
        await removeTagFromThread(selectedThreadId, tag.id);
        setThreadTagsMap((prev) => ({
          ...prev,
          [selectedThreadId]: (prev[selectedThreadId] ?? []).filter((t) => t.id !== tag.id),
        }));
      } catch (e) {
        console.error('Failed to remove tag from thread:', e);
      }
    },
    [selectedThreadId, setThreadTagsMap]
  );

  const handleUpdateTag = useCallback(
    (updated: ThreadTag) => {
      setAccountTags((p) => p.map((t) => (t.id === updated.id ? updated : t)));
      if (selectedThreadId) {
        setThreadTagsMap((prev) => ({
          ...prev,
          [selectedThreadId]: (prev[selectedThreadId] ?? []).map((t) =>
            t.id === updated.id ? updated : t
          ),
        }));
      }
    },
    [selectedThreadId, setAccountTags, setThreadTagsMap]
  );

  const handleDeleteTag = useCallback(
    (deleted: ThreadTag) => {
      setAccountTags((p) => p.filter((t) => t.id !== deleted.id));
      setThreadTagsMap((prev) => {
        const next = { ...prev };
        for (const threadId of Object.keys(next)) {
          next[threadId] = (next[threadId] ?? []).filter((t) => t.id !== deleted.id);
        }
        return next;
      });
    },
    [setAccountTags, setThreadTagsMap]
  );

  const handleClearAllFilters = useCallback(() => {
    clearAllFilters();
  }, [clearAllFilters]);

  useEffect(() => {
    const previousThreadId = prevSelectedThreadIdRef.current;
    const previousLength = prevMessagesLengthRef.current;
    const threadChanged = previousThreadId !== selectedThreadId;
    const messagesIncreased = messages.length > previousLength;
    if (threadChanged || messagesIncreased) {
      autoScrollArmedRef.current = true;
    }
    prevMessagesLengthRef.current = messages.length;
    prevSelectedThreadIdRef.current = selectedThreadId;
  }, [messages.length, selectedThreadId, pendingReplies.length, composerMode]);

  const handleFetchAttachmentBlob = useCallback(
    async (emailMessageId: string, part: string): Promise<Blob | null> => {
      if (!FETCH_ATTACHMENT_URL) return null;
      try {
        const token = await getAccessToken();
        if (!token) return null;
        return await fetchAttachment(FETCH_ATTACHMENT_URL, token, emailMessageId, part);
      } catch {
        return null;
      }
    },
    []
  );

  const handleDownloadAttachment = useCallback(
    async (emailMessageId: string, part: string, filename: string) => {
      const blob = await handleFetchAttachmentBlob(emailMessageId, part);
      if (!blob) return;
      try {
        if (Platform.OS === 'web') {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename || 'attachment';
          a.click();
          URL.revokeObjectURL(url);
        } else {
          // Native: download not yet implemented (web only for now)
          // TODO: Add expo-file-system + expo-sharing for native save/share
        }
      } catch (err) {
        console.error('Download attachment failed:', err);
      }
    },
    [handleFetchAttachmentBlob]
  );

  const REPLY_PANEL_WIDTH = Math.min(800, Math.max(520, winWidth * 0.58));

  const mobileMessageViewTitle =
    selectedThread &&
    resolveThreadCardTitle({
      thread: selectedThread,
      leadDisplayName: selectedThread.lead_id ? leadDisplayNamesMap[selectedThread.lead_id] : null,
      leadEmail: selectedThread.lead_id ? leadEmailById[selectedThread.lead_id] : null,
      mailboxEmail: selectedThread.mailbox_id ? mailboxEmailById[selectedThread.mailbox_id] : null,
      subject: selectedThread.subject,
    });

  const selectedThreadRecipientEmail =
    selectedThread &&
    resolveThreadRecipientEmail({
      thread: selectedThread,
      leadEmail: selectedThread.lead_id ? leadEmailById[selectedThread.lead_id] : null,
      mailboxEmail: selectedThread.mailbox_id ? mailboxEmailById[selectedThread.mailbox_id] : null,
    });

  const pendingRepliesInfo =
    selectedThreadId == null
      ? []
      : pendingReplies
          .filter((p) => p.threadId === selectedThreadId)
          .map((p) => ({
            kind: p.kind,
            threadId: p.threadId,
            jobId: p.jobId,
            isFailed: p.isFailed,
            errorMessage: p.errorMessage,
            jobStatus: p.jobStatus,
            scheduledAt: p.scheduledAt,
            sendWaitReason: p.sendWaitReason,
            isSendingImmediately: p.isSendingImmediately,
            campaignName: p.kind === 'campaign_reply' ? selectedThreadCampaignName : null,
          }));

  const threadListProps = useMemo(
    () => ({
      threads,
      displayThreads,
      threadsError,
      showThreadListSkeleton: loadingPolicy.showThreadListSkeleton,
      suppressEmptyStates: loadingPolicy.suppressEmptyStates,
      keepPreviousThreadList: loadingPolicy.keepPreviousThreadList,
      threadsLoading,
      threadSearchQuery,
      setThreadSearchQuery,
      filterButtonRef,
      onFilterPress: () => openFilterMenu(filterButtonRef),
      hasActiveFilters,
      refreshing,
      onRefresh: handleRefresh,
      loadMoreThreads,
      hasMoreThreads,
      loadingMoreThreads,
      leadDisplayNamesMap,
      leadEmailById,
      mailboxEmailById,
      campaigns,
      threadSnippetsMap,
      threadTagsMap,
      onSelectThread: handleSelectThread,
      onRetryLoadThreads: () => loadThreads(),
    }),
    [
      threads,
      displayThreads,
      threadsError,
      loadingPolicy.showThreadListSkeleton,
      loadingPolicy.suppressEmptyStates,
      loadingPolicy.keepPreviousThreadList,
      threadsLoading,
      threadSearchQuery,
      setThreadSearchQuery,
      filterButtonRef,
      openFilterMenu,
      hasActiveFilters,
      refreshing,
      handleRefresh,
      loadMoreThreads,
      hasMoreThreads,
      loadingMoreThreads,
      leadDisplayNamesMap,
      leadEmailById,
      mailboxEmailById,
      campaigns,
      threadSnippetsMap,
      threadTagsMap,
      handleSelectThread,
      loadThreads,
    ]
  );

  const messageViewProps = useMemo(
    () => ({
      showMessagePaneSkeleton: loadingPolicy.showMessagePaneSkeleton,
      showMessageBodySkeleton: loadingPolicy.showMessageBodySkeleton,
      selectedThread: selectedThread ?? null,
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
      leadReplacementSummary: selectedThreadReplacementSummary,
      accountId,
      onBlock: accountId ? () => setBlockModalVisible(true) : undefined,
      onMarkOutOfOffice:
        accountId && selectedThreadId
          ? () => void threadActions.runFromMessageMenu('mark_out_of_office')
          : undefined,
      onReplaceLead:
        accountId && selectedThread?.lead_id
          ? () => void threadActions.runFromMessageMenu('replace_lead')
          : undefined,
      onCloseConversation:
        selectedThread?.conversation_status !== 'closed' ? () => void closeSelectedConversation('user') : undefined,
      onOpenConversation:
        selectedThread?.conversation_status === 'closed' ? () => void openSelectedConversation('user') : undefined,
      onOpenLeadDetail: selectedThread?.lead_id ? openLeadDetailFromInbox : undefined,
      onOpenTagsPanel: selectedThreadId && accountId ? () => setTagsPanelVisible(true) : undefined,
      category: selectedThread?.category ?? null,
      onSetCategory: handleSetThreadCategory,
      messagesScrollViewRef,
      onContentSizeChange,
      onReply: openReplyComposer,
      onForward: openForwardComposer,
      onDownloadAttachment: FETCH_ATTACHMENT_URL ? handleDownloadAttachment : undefined,
      onFetchAttachmentPreview: FETCH_ATTACHMENT_URL ? handleFetchAttachmentBlob : undefined,
      pendingReplies: pendingRepliesInfo,
      onRetryFailedReply: retryFailedReply,
      onSendImmediately: sendPendingImmediately,
      onCancelPendingOutbound: cancelPendingOutbound,
      threadStatusCallout: loadingPolicy.messagePaneContentReady ? threadStatusCalloutView : null,
    }),
    [
      loadingPolicy.showMessagePaneSkeleton,
      loadingPolicy.showMessageBodySkeleton,
      loadingPolicy.messagePaneContentReady,
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
      selectedThreadReplacementSummary,
      accountId,
      setBlockModalVisible,
      threadActions.runFromMessageMenu,
      closeSelectedConversation,
      openSelectedConversation,
      openLeadDetailFromInbox,
      setTagsPanelVisible,
      handleSetThreadCategory,
      onContentSizeChange,
      openReplyComposer,
      openForwardComposer,
      handleDownloadAttachment,
      handleFetchAttachmentBlob,
      pendingRepliesInfo,
      retryFailedReply,
      sendPendingImmediately,
      cancelPendingOutbound,
      threadStatusCalloutView,
    ]
  );

  const composerPanelFormProps = useMemo(
    () => ({
      replyToEmail,
      setReplyToEmail,
      replyCc,
      setReplyCc,
      replySubject,
      setReplySubject,
      forwardToEmail,
      setForwardToEmail,
      forwardCc,
      setForwardCc,
      forwardSubject,
      setForwardSubject,
      composerEditorRef,
      composerAttachments,
      setComposerAttachments,
      onFilesSelected: handleComposerFilesSelected,
      composerAttachmentsLoading,
      composerAttachmentsSkipMessage,
      includeSignature,
      setIncludeSignature,
      forwardQuoteHtml,
      replyEditorMode,
      forwardEditorMode,
      replyHtmlDraft,
      setReplyHtmlDraft,
      forwardHtmlDraft,
      setForwardHtmlDraft,
      replyRichInitialContent,
      forwardRichInitialContent,
      onSwitchReplyToHtml: () => switchComposerToHtml('reply'),
      onSwitchForwardToHtml: () => switchComposerToHtml('forward'),
      switchToRichConfirmMode,
      onRequestSwitchToRich: (mode: 'reply' | 'forward') => setSwitchToRichConfirmMode(mode),
      onCancelSwitchToRich: () => setSwitchToRichConfirmMode(null),
      onConfirmSwitchToRich: confirmSwitchComposerToRich,
      onSendReply: () => sendReply(),
      onSendForward: () => sendForward(),
      sendingReply,
      sendingForward,
      hideAttachmentTrigger: Platform.OS === 'web',
    }),
    [
      replyToEmail,
      setReplyToEmail,
      replyCc,
      setReplyCc,
      replySubject,
      setReplySubject,
      forwardToEmail,
      setForwardToEmail,
      forwardCc,
      setForwardCc,
      forwardSubject,
      setForwardSubject,
      composerEditorRef,
      composerAttachments,
      setComposerAttachments,
      handleComposerFilesSelected,
      composerAttachmentsLoading,
      composerAttachmentsSkipMessage,
      includeSignature,
      setIncludeSignature,
      forwardQuoteHtml,
      replyEditorMode,
      forwardEditorMode,
      replyHtmlDraft,
      setReplyHtmlDraft,
      forwardHtmlDraft,
      setForwardHtmlDraft,
      replyRichInitialContent,
      forwardRichInitialContent,
      switchComposerToHtml,
      switchToRichConfirmMode,
      setSwitchToRichConfirmMode,
      confirmSwitchComposerToRich,
      sendReply,
      sendForward,
      sendingReply,
      sendingForward,
    ]
  );

  const modalProps = useMemo(
    () => ({
      filters: {
        filterMenuOpen,
        setFilterMenuOpen,
        filterAnchorLayout,
        unreadOnlyFilter,
        setUnreadOnlyFilter,
        datePreset,
        setDatePreset,
        mailboxFilterId,
        setMailboxFilterId,
        campaignFilterId,
        setCampaignFilterId,
        categoryFilter,
        setCategoryFilter,
        conversationStatusFilter,
        setConversationStatusFilter,
        tagFilterIds,
        setTagFilterIds,
        campaignTagFilterIds,
        setCampaignTagFilterIds,
        mailboxes,
        campaigns,
        accountTags,
        accountCampaignTags,
        onClearAllFilters: handleClearAllFilters,
        filterPresentation: (isMobile ? 'sheet' : 'dropdown') as 'dropdown' | 'sheet',
        filterSheetMaxHeight: winHeight * 0.9,
      },
      visibility: {
        blockModalVisible,
        setBlockModalVisible,
        tagsPanelVisible,
        setTagsPanelVisible,
        showMessageActionsSheet,
        setShowMessageActionsSheet,
        blockedRecipientConfirm,
        setBlockedRecipientConfirm,
        replyDuplicateConfirm,
        setReplyDuplicateConfirm,
        infoSheetVisible,
        setInfoSheetVisible,
      },
      actions: {
        accountId,
        selectedThreadProspectEmails,
        onBlocked: loadBlockList,
        selectedThreadId,
        threadTagsMap,
        selectedThread: selectedThread ?? null,
        campaignName: selectedThreadCampaignName,
        replacementSummary: selectedThreadReplacementSummary,
        onSetCategory: handleSetThreadCategory,
        onTagCreated: handleTagCreated,
        onAddTag: handleAddTagToSelectedThread,
        onRemoveTag: handleRemoveTagFromSelectedThread,
        onUpdateTag: handleUpdateTag,
        onDeleteTag: handleDeleteTag,
        onMarkOutOfOffice:
          accountId && selectedThreadId
            ? () => void threadActions.runFromMessageMenu('mark_out_of_office')
            : undefined,
        onReplaceLead:
          accountId && selectedThread?.lead_id
            ? () => {
                threadActions.queueDeferredOpen('replace_lead');
              }
            : undefined,
        onCloseConversation:
          selectedThread?.conversation_status !== 'closed'
            ? () => {
                void closeSelectedConversation('user');
              }
            : undefined,
        onOpenConversation:
          selectedThread?.conversation_status === 'closed'
            ? () => {
                void openSelectedConversation('user');
              }
            : undefined,
        onMessageActionsSheetAfterClose: threadActions.consumeQueuedOpen,
      },
    }),
    [
      filterMenuOpen,
      setFilterMenuOpen,
      filterAnchorLayout,
      unreadOnlyFilter,
      setUnreadOnlyFilter,
      datePreset,
      setDatePreset,
      mailboxFilterId,
      setMailboxFilterId,
      campaignFilterId,
      setCampaignFilterId,
      categoryFilter,
      setCategoryFilter,
      conversationStatusFilter,
      setConversationStatusFilter,
      tagFilterIds,
      setTagFilterIds,
      campaignTagFilterIds,
      setCampaignTagFilterIds,
      mailboxes,
      campaigns,
      accountTags,
      accountCampaignTags,
      handleClearAllFilters,
      isMobile,
      winHeight,
      blockModalVisible,
      setBlockModalVisible,
      tagsPanelVisible,
      setTagsPanelVisible,
      showMessageActionsSheet,
      setShowMessageActionsSheet,
      blockedRecipientConfirm,
      setBlockedRecipientConfirm,
      replyDuplicateConfirm,
      setReplyDuplicateConfirm,
      infoSheetVisible,
      setInfoSheetVisible,
      accountId,
      selectedThreadProspectEmails,
      loadBlockList,
      selectedThreadId,
      threadTagsMap,
      selectedThread,
      selectedThreadCampaignName,
      selectedThreadReplacementSummary,
      handleSetThreadCategory,
      handleTagCreated,
      handleAddTagToSelectedThread,
      handleRemoveTagFromSelectedThread,
      handleUpdateTag,
      handleDeleteTag,
      threadActions.runFromMessageMenu,
      threadActions.queueDeferredOpen,
      threadActions.consumeQueuedOpen,
      selectedThread?.lead_id,
      selectedThread?.conversation_status,
      closeSelectedConversation,
      openSelectedConversation,
    ]
  );

  const desktopMessagePane = {
    ...messageViewProps,
    selectedThread: selectedThread ?? undefined,
    onSetCategory: selectedThreadId && accountId ? handleSetThreadCategory : undefined,
  };

  const mobileMessageViewScrollable = isMobile && (!!selectedThreadId || loadingPolicy.showMessagePaneSkeleton);

  return (
    <PageLayout
      scrollable={false}
      mobileLayout={mobileMessageViewScrollable ? 'scrollable' : 'fixed'}
    >
      {isMobile ? (
        !selectedThreadId && !loadingPolicy.showMessagePaneSkeleton ? (
          <View className="flex-1">
            <InboxThreadList
              {...threadListProps}
              selectedThreadId={null}
              scrollPaddingBottom={6 + BOTTOM_NAV_SCROLL_PADDING}
            />
          </View>
        ) : (
          <View className="flex-1 bg-[#121212] min-h-0">
            <InboxMobileMessageView
              messagePane={messageViewProps}
              mobile={{
                mobileMessageViewTitle: mobileMessageViewTitle ?? null,
                onBack: () => {
                  router.replace(buildInboxListHref());
                },
                onOpenMessageActions: () => setShowMessageActionsSheet(true),
              }}
            />
          </View>
        )
      ) : (
        <InboxDesktopLayout
          threadList={{ ...threadListProps, selectedThreadId, scrollPaddingBottom: 6 }}
          messagePane={desktopMessagePane}
          layout={{ slideAnim, replyPanelWidth: REPLY_PANEL_WIDTH }}
          composerPanel={{
            composerMode,
            closeComposerPanel,
            composerFormProps: composerPanelFormProps,
          }}
        />
      )}

      <InboxModals
        filters={modalProps.filters}
        visibility={modalProps.visibility}
        actions={modalProps.actions}
      />

      {accountId && selectedThreadId && selectedThread ? (
        <MarkOutOfOfficeModal
          key={`${selectedThreadId}:${threadActions.pendingOooActionId ?? 'mark_out_of_office'}`}
          visible={threadActions.oooModalVisible}
          onClose={threadActions.closeOooModal}
          threadId={selectedThreadId}
          prefilledReturnDateYmd={effectiveOooPrefillYmd}
          isCurrentlyOutOfOffice={!!selectedThread.out_of_office}
          markAutoReplyOnSave
          onSaved={() =>
            threadActions.completeDeferredAction(
              threadActions.pendingOooActionId ?? 'mark_out_of_office',
            )
          }
        />
      ) : null}

      {!isMobile && accountId && selectedThread?.lead_id ? (
        <ReplaceLeadModal
          visible={threadActions.replaceLeadModalVisible}
          onClose={() => threadActions.setReplaceLeadModalVisible(false)}
          oldLead={leadByIdMap[selectedThread.lead_id] ?? null}
          prefill={replaceLeadPrefill}
          sourceMessageId={latestReceivedInbound?.id ?? null}
          onReplaced={(_result, completion) => {
            void threadActions.completeDeferredAction('replace_lead', completion);
          }}
        />
      ) : null}

      {/* Reply/Forward composer: full-size sheet on mobile */}
      {composerMode && isMobile && (
        <InboxComposerPanel
          variant="sheet"
          onClose={closeComposerPanel}
          sheetMaxHeight={winHeight * 0.9}
          mode={composerMode}
          {...composerPanelFormProps}
        />
      )}
    </PageLayout>
  );
}
