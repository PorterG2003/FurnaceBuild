import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Modal,
} from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import { PageLayout } from '@/components/ui/layout';
import { EmptyState, Alert, useToast } from '@/components/ui/feedback';
import { ConfirmDeleteModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import {
  getThreadsByAccount,
  getMessagesByThread,
  createReplyJob,
  createForwardJob,
  getMessageJobStatus,
  getPendingInboxReplyJobs,
  fetchAttachment,
  getBlockList,
  isEmailBlockedByEntries,
  markThreadMessagesRead,
  getMailboxesByAccount,
  getCampaigns,
  getThreadTags,
  getTagsForThreads,
  getThreadSnippets,
  getLeadsByIds,
  getLeadDisplayName,
  addTagToThread,
  removeTagFromThread,
  updateThreadTag,
  updateThreadCategory,
} from '@/lib/supabase/services';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { EmailThread, EmailMessage, BlockListEntry, Mailbox, Campaign } from '@/lib/supabase/types';
import { groupMessagesByDate } from '@/lib/inbox';
import { buildQuotedForwardThreadHtml } from '@/lib/inbox/quote-utils';
import { MagnifyingGlassIcon, PaperAirplaneIcon, FunnelIcon } from 'react-native-heroicons/outline';
import type { EditorBridge } from '@10play/tentap-editor';
import {
  BlockSenderModal,
  ComposerAttachments,
  CreateTagModal,
  ComposerRichEditor,
  DateDivider,
  InboxFilterDropdown,
  MessageBubble,
  MessagePanelHeader,
  MessagePanelHeaderSkeleton,
  MessageListSkeleton,
  ThreadItem,
  ThreadListSkeleton,
  TagsPanelModal,
  SKELETON_DELAY_MS,
  SKELETON_MIN_DISPLAY_MS,
} from '@/components/inbox';
import type { ComposerAttachmentItem } from '@/components/inbox';
import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '@/amplify_outputs.json';

const FETCH_ATTACHMENT_URL = (outputs as { custom?: { fetchEmailAttachmentUrl?: string } }).custom?.fetchEmailAttachmentUrl;

const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const THREAD_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 400;
const THREAD_CATEGORIES = ['Interested', 'Not Interested'];

export default function InboxPage() {
  const { account } = useAccount();
  const { toast } = useToast();
  const accountId = account?.id ?? null;
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [composerMode, setComposerMode] = useState<'reply' | 'forward' | null>(null);
  const [inReplyToMessageId, setInReplyToMessageId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState('');
  const [replyToName, setReplyToName] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const composerEditorRef = useRef<EditorBridge | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [forwardedMessageId, setForwardedMessageId] = useState<string | null>(null);
  const [forwardToEmail, setForwardToEmail] = useState('');
  const [forwardCc, setForwardCc] = useState('');
  const [forwardSubject, setForwardSubject] = useState('');
  const [sendingForward, setSendingForward] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachmentItem[]>([]);
  const [composerAttachmentsLoading, setComposerAttachmentsLoading] = useState(false);
  const [composerAttachmentsSkipMessage, setComposerAttachmentsSkipMessage] = useState<string | null>(null);

  const [showThreadSkeleton, setShowThreadSkeleton] = useState(false);
  const [showMessagesSkeleton, setShowMessagesSkeleton] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [mailboxFilterId, setMailboxFilterId] = useState<string | null>(null);
  const [campaignFilterId, setCampaignFilterId] = useState<string | null>(null);
  const [unreadOnlyFilter, setUnreadOnlyFilter] = useState(false);
  const [datePreset, setDatePreset] = useState<'7d' | '30d' | null>(null);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [threadOffset, setThreadOffset] = useState(0);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [blockList, setBlockList] = useState<BlockListEntry[]>([]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterAnchorLayout, setFilterAnchorLayout] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const filterButtonRef = useRef<View>(null);
  const [threadTagsMap, setThreadTagsMap] = useState<Record<string, ThreadTag[]>>({});
  const [threadSnippetsMap, setThreadSnippetsMap] = useState<Record<string, string>>({});
  const [leadDisplayNamesMap, setLeadDisplayNamesMap] = useState<Record<string, string>>({});
  const [accountTags, setAccountTags] = useState<ThreadTag[]>([]);
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [createTagModalVisible, setCreateTagModalVisible] = useState(false);
  const [tagsPanelVisible, setTagsPanelVisible] = useState(false);
  const [blockedRecipientConfirm, setBlockedRecipientConfirm] = useState<{
    mode: 'reply' | 'forward';
    onConfirm: () => void;
  } | null>(null);

  type PendingReply = {
    threadId: string;
    jobId: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    toEmail: string;
    toName: string | null;
    cc: string[];
    fromEmail: string;
    receivedAt: string;
    messageCountWhenPending: number;
    errorMessage?: string | null;
    isFailed?: boolean;
    inReplyToMessageId: string;
    attachments?: Array<{ filename: string; contentType: string; content: string }>;
  };
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesScrollViewRef = useRef<ScrollView>(null);
  const lastContentHeightRef = useRef(0);
  const prevMessagesLengthRef = useRef(0);
  const prevSelectedThreadIdRef = useRef<string | null>(null);
  const autoScrollArmedRef = useRef(false);
  const selectedThreadIdRef = useRef(selectedThreadId);
  selectedThreadIdRef.current = selectedThreadId;

  const handleComposerFilesSelected = useCallback(
    async (files: FileList) => {
      if (!files?.length) return;
      setComposerAttachmentsLoading(true);
      setComposerAttachmentsSkipMessage(null);
      const toAdd: ComposerAttachmentItem[] = [];
      let skippedTooBig = 0;
      let skippedTotal = 0;
      let skippedCount = 0;
      let skippedOther = 0;
      const currentTotal = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
      for (let i = 0; i < files.length; i++) {
        if (composerAttachments.length + toAdd.length >= MAX_ATTACHMENTS) {
          skippedCount += files.length - i;
          break;
        }
        const file = files[i];
        if (file.size > MAX_FILE_BYTES) {
          skippedTooBig += 1;
          continue;
        }
        const runningTotal = currentTotal + toAdd.reduce((s, a) => s + (a.size ?? 0), 0);
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          skippedTotal += 1;
          continue;
        }
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const match = result?.match(/^data:([^;]+);base64,(.+)$/);
              if (match) resolve(match[2]);
              else reject(new Error('Invalid data URL'));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          toAdd.push({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            content: base64,
            size: file.size,
          });
        } catch {
          skippedOther += 1;
        }
      }
      setComposerAttachmentsLoading(false);
      if (toAdd.length > 0) {
        setComposerAttachments((prev) => [...prev, ...toAdd]);
      }
      const skippedTotalCount = skippedTooBig + skippedTotal + skippedCount + skippedOther;
      if (skippedTotalCount > 0) {
        const parts: string[] = [];
        if (skippedTooBig > 0) parts.push(`${skippedTooBig} over 2 MB`);
        if (skippedTotal > 0) parts.push(`${skippedTotal} would exceed 5 MB total`);
        if (skippedCount > 0) parts.push(`${skippedCount} over 10 file limit`);
        if (skippedOther > 0) parts.push(`${skippedOther} could not be read`);
        setComposerAttachmentsSkipMessage(
          toAdd.length > 0
            ? `${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
            : `No files added. ${skippedTotalCount} file${skippedTotalCount !== 1 ? 's' : ''} skipped (${parts.join(', ')})`
        );
      }
    },
    [composerAttachments]
  );

  const threadSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });
  const messagesSkeletonTimers = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({ show: null, hide: null });

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const threadsLoadingOrNoAccount = threadsLoading || !accountId;

  // Server-driven filtering: threads are already filtered by getThreadsByAccount
  const displayThreads = threads;
  const hasActiveFilters =
    !!mailboxFilterId ||
    !!campaignFilterId ||
    unreadOnlyFilter ||
    !!datePreset ||
    tagFilterIds.length > 0 ||
    !!categoryFilter ||
    threadSearchQuery.trim().length > 0;

  const selectedThreadProspectEmails = useMemo(() => {
    if (!selectedThreadId || !messages.length) return [];
    const displayMessages = pendingReply && selectedThreadId === pendingReply.threadId
      ? [
          ...messages,
          {
            id: 'pending-' + pendingReply.jobId,
            direction: 'sent' as const,
            from_email: pendingReply.fromEmail,
            from_name: null,
            to_email: pendingReply.toEmail,
            to_name: null,
            cc: null,
            subject: pendingReply.subject,
            body_text: pendingReply.bodyText,
            body_html: pendingReply.bodyHtml,
            message_id: null,
            in_reply_to: null,
            message_references: null,
            received_at: pendingReply.receivedAt,
            read_at: null,
            headers: {},
            attachments: [],
            imap_uid: null,
            created_at: pendingReply.receivedAt,
            updated_at: pendingReply.receivedAt,
          },
        ].sort(
          (a, b) =>
            new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
        )
      : messages;
    return [
      ...new Set(
        displayMessages.filter((m) => m.direction === 'received').map((m) => m.from_email)
      ),
    ];
  }, [selectedThreadId, messages, pendingReply]);

  const blockedProspectEmails = useMemo(() => {
    const blocked = new Set<string>();
    for (const email of selectedThreadProspectEmails) {
      if (isEmailBlockedByEntries(email, blockList)) {
        blocked.add(email.trim().toLowerCase());
      }
    }
    return blocked;
  }, [selectedThreadProspectEmails, blockList]);

  const buildThreadFilters = useCallback(() => {
    let dateFrom: string | undefined;
    if (datePreset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      dateFrom = d.toISOString();
    } else if (datePreset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      dateFrom = d.toISOString();
    }
    return {
      hasReplyOnly: true,
      includeUnreadCount: true,
      limit: THREAD_PAGE_SIZE,
      offset: 0,
      mailboxId: mailboxFilterId ?? undefined,
      campaignId: campaignFilterId ?? undefined,
      unreadOnly: unreadOnlyFilter || undefined,
      dateFrom,
      dateTo: undefined,
      searchQuery: threadSearchQuery.trim() || undefined,
      tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
      category: categoryFilter ?? undefined,
    };
  }, [mailboxFilterId, campaignFilterId, unreadOnlyFilter, datePreset, threadSearchQuery, tagFilterIds, categoryFilter]);

  const handleRefresh = useCallback(async () => {
    if (!accountId) return;
    setRefreshing(true);
    setThreadOffset(0);
    try {
      const opts = buildThreadFilters();
      const [list] = await Promise.all([
        getThreadsByAccount(accountId, opts),
        loadBlockList(),
      ]);
      setThreads(list);
      setHasMoreThreads(list.length >= THREAD_PAGE_SIZE);
      if (list.length === 0) {
        setSelectedThreadId(null);
      } else if (
        !selectedThreadId ||
        !list.some((t) => t.id === selectedThreadId)
      ) {
        setSelectedThreadId(list[0].id);
      }
    } finally {
      setRefreshing(false);
    }
  }, [accountId, selectedThreadId, buildThreadFilters]);

  const loadThreadsRef = useRef<(options?: { append?: boolean }) => Promise<void>>(() => Promise.resolve());
  const loadThreads = useCallback(async (options?: { append?: boolean }) => {
    if (!accountId) return;
    const append = options?.append ?? false;
    const offset = append ? threadOffset : 0;
    if (!append) {
      setThreadsError(null);
      setThreadsLoading(true);
    } else {
      setLoadingMoreThreads(true);
    }
    try {
      const opts = {
        ...buildThreadFilters(),
        offset,
        limit: THREAD_PAGE_SIZE,
      };
      const list = await getThreadsByAccount(accountId, opts);
      if (append) {
        setThreads((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newThreads = list.filter((t) => !existingIds.has(t.id));
          return [...prev, ...newThreads];
        });
        setThreadOffset((o) => o + list.length);
        setHasMoreThreads(list.length >= THREAD_PAGE_SIZE);
      } else {
        setThreads(list);
        setThreadOffset(list.length);
        setHasMoreThreads(list.length >= THREAD_PAGE_SIZE);
        if (list.length === 0) {
          setSelectedThreadId(null);
        } else {
          const current = selectedThreadIdRef.current;
          if (!current || !list.some((t) => t.id === current)) {
            setSelectedThreadId(list[0].id);
          }
        }
      }
    } catch (err) {
      if (!append) {
        setThreadsError(err instanceof Error ? err.message : 'Failed to load conversations');
      }
    } finally {
      setThreadsLoading(false);
      setLoadingMoreThreads(false);
    }
  }, [accountId, buildThreadFilters, threadOffset]);
  loadThreadsRef.current = loadThreads;

  const loadMoreThreads = useCallback(() => {
    loadThreads({ append: true });
  }, [loadThreads]);

  const loadMailboxesAndCampaigns = useCallback(async () => {
    if (!accountId) return;
    try {
      const [mbList, campList, tagsList] = await Promise.all([
        getMailboxesByAccount(accountId),
        getCampaigns({ accountId }),
        getThreadTags(accountId),
      ]);
      setMailboxes(mbList);
      setCampaigns(campList);
      setAccountTags(tagsList);
    } catch (err) {
      console.error('Failed to load mailboxes/campaigns/tags:', err);
    }
  }, [accountId]);

  const loadMessages = useCallback(async (threadId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setMessagesError(null);
      setMessagesLoading(true);
    }
    try {
      const list = await getMessagesByThread(threadId);
      setMessages(list);
    } catch (err) {
      if (!options?.silent) {
        setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
      }
    } finally {
      if (!options?.silent) {
        setMessagesLoading(false);
      }
    }
  }, []);

  // Restore pending reply from database for the selected thread
  const restorePendingReply = useCallback(async () => {
    if (!accountId || !selectedThreadId) return;
    try {
      const pendingJobs = await getPendingInboxReplyJobs(accountId);
      const jobForThread = pendingJobs.find((j) => j.thread_id === selectedThreadId);
      if (!jobForThread) return;

      // Get fromEmail from sent messages in the thread
      const threadMessages = await getMessagesByThread(selectedThreadId);
      const fromEmail = threadMessages.find((m) => m.direction === 'sent')?.from_email ?? '';

      setPendingReply({
        threadId: jobForThread.thread_id,
        jobId: jobForThread.id,
        subject: jobForThread.message_data.subject,
        bodyText: jobForThread.message_data.body_text,
        bodyHtml: jobForThread.message_data.body_html,
        toEmail: jobForThread.message_data.to_email,
        toName: jobForThread.message_data.to_name || null,
        cc: jobForThread.message_data.cc || [],
        fromEmail,
        receivedAt: new Date().toISOString(), // Use current time for display
        messageCountWhenPending: threadMessages.length,
        errorMessage: jobForThread.error_message,
        isFailed: jobForThread.status === 'failed',
        inReplyToMessageId: jobForThread.message_data.in_reply_to_message_id,
        attachments: jobForThread.message_data.attachments,
      });

      // Start polling for this job
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      const jobIdToPoll = jobForThread.id;
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        // Check job status
        try {
          const jobStatus = await getMessageJobStatus(jobIdToPoll);
          if (jobStatus) {
            if (jobStatus.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobIdToPoll
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (jobStatus.status === 'sent') {
              // Job succeeded, clear pending when message appears
              // (handled by the effect checking messages.length)
            }
          }
        } catch (err) {
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to restore pending reply:', err);
    }
  }, [accountId, selectedThreadId, loadMessages]);

  const loadBlockList = useCallback(async () => {
    if (!accountId) return;
    try {
      const list = await getBlockList(accountId);
      setBlockList(list);
    } catch (err) {
      console.error('Failed to load block list:', err);
    }
  }, [accountId]);

  const handleSelectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    markThreadMessagesRead(threadId).catch((err) => console.error('Failed to mark thread as read:', err));
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId && 'unread_count' in t ? { ...t, unread_count: 0 } : t))
    );
  }, []);

  const initialLoadDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accountId) {
      setThreadsLoading(false);
      setThreads([]);
      setBlockList([]);
      initialLoadDoneRef.current = null;
      return;
    }
    if (initialLoadDoneRef.current === accountId) return;
    initialLoadDoneRef.current = accountId;
    loadMailboxesAndCampaigns();
    loadThreads();
    loadBlockList();
  }, [accountId, loadThreads, loadBlockList, loadMailboxesAndCampaigns]);

  // Load tags, snippets, and lead display names for displayed threads
  useEffect(() => {
    if (threads.length === 0) {
      setThreadTagsMap({});
      setThreadSnippetsMap({});
      setLeadDisplayNamesMap({});
      return;
    }
    const ids = threads.map((t) => t.id);
    const leadIds = [...new Set(threads.map((t) => t.lead_id).filter(Boolean))] as string[];
    Promise.all([
      getTagsForThreads(ids),
      getThreadSnippets(ids),
      leadIds.length > 0 ? getLeadsByIds(leadIds) : Promise.resolve([]),
    ])
      .then(([tags, snippets, leads]) => {
        setThreadTagsMap(tags);
        setThreadSnippetsMap(snippets);
        const leadNames: Record<string, string> = {};
        for (const lead of leads) {
          const name = getLeadDisplayName(lead);
          if (name) leadNames[lead.id] = name;
        }
        setLeadDisplayNamesMap(leadNames);
      })
      .catch((err) => console.error('Failed to load thread tags/snippets/leads:', err));
  }, [threads]);

  // Refetch when non-search filters change (skip initial mount to avoid double-fetch)
  const filtersEffectRanRef = useRef(false);
  useEffect(() => {
    if (!accountId) return;
    if (!filtersEffectRanRef.current) {
      filtersEffectRanRef.current = true;
      return;
    }
    setThreadOffset(0);
    loadThreadsRef.current();
  }, [accountId, mailboxFilterId, campaignFilterId, unreadOnlyFilter, datePreset, tagFilterIds, categoryFilter]);

  // Debounced refetch when search query changes
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!accountId) return;
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      setThreadOffset(0);
      loadThreadsRef.current();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [accountId, threadSearchQuery]);

  // Restore pending reply when thread is selected
  useEffect(() => {
    if (accountId && selectedThreadId && !threadsLoading) {
      restorePendingReply();
    }
  }, [accountId, selectedThreadId, threadsLoading, restorePendingReply]);

  useEffect(() => {
    if (selectedThreadId) {
      loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId, loadMessages]);

  // Thread skeleton: delay 200ms before showing, min 300ms once shown
  useEffect(() => {
    const t = threadSkeletonTimers.current;
    if (threadsLoadingOrNoAccount) {
      if (t.hide) {
        clearTimeout(t.hide);
        t.hide = null;
      }
      t.show = setTimeout(() => setShowThreadSkeleton(true), SKELETON_DELAY_MS);
      return () => {
        if (t.show) clearTimeout(t.show);
        t.show = null;
      };
    } else {
      if (t.show) {
        clearTimeout(t.show);
        t.show = null;
      }
      if (showThreadSkeleton) {
        t.hide = setTimeout(() => setShowThreadSkeleton(false), SKELETON_MIN_DISPLAY_MS);
        return () => {
          if (t.hide) clearTimeout(t.hide);
          t.hide = null;
        };
      }
    }
  }, [threadsLoadingOrNoAccount, showThreadSkeleton]);

  // Messages skeleton: delay 200ms before showing, min 300ms once shown
  useEffect(() => {
    const t = messagesSkeletonTimers.current;
    if (messagesLoading) {
      if (t.hide) {
        clearTimeout(t.hide);
        t.hide = null;
      }
      t.show = setTimeout(() => setShowMessagesSkeleton(true), SKELETON_DELAY_MS);
      return () => {
        if (t.show) clearTimeout(t.show);
        t.show = null;
      };
    } else {
      if (t.show) {
        clearTimeout(t.show);
        t.show = null;
      }
      if (showMessagesSkeleton) {
        t.hide = setTimeout(() => setShowMessagesSkeleton(false), SKELETON_MIN_DISPLAY_MS);
        return () => {
          if (t.hide) clearTimeout(t.hide);
          t.hide = null;
        };
      }
    }
  }, [messagesLoading, showMessagesSkeleton]);

  // Clear pending reply when thread changes or when sent message appears (polling)
  useEffect(() => {
    if (!pendingReply) return;
    if (selectedThreadId !== pendingReply.threadId) {
      setPendingReply(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }
    // If failed, don't clear on message count change (user needs to see error)
    if (!pendingReply.isFailed && messages.length > pendingReply.messageCountWhenPending) {
      setPendingReply(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [pendingReply, selectedThreadId, messages.length]);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const scrollMessagesToEnd = useCallback((reason: string, nextHeight?: number) => {
    if (typeof nextHeight === 'number') {
      lastContentHeightRef.current = nextHeight;
    }
    messagesScrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

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
  }, [messages.length, selectedThreadId, pendingReply, composerMode]);

  const openReplyComposer = useCallback(
    (message: EmailMessage) => {
      if (!selectedThread) return;
      const lastReceived = [...messages].reverse().find((m) => m.direction === 'received');
      const toEmail = message.direction === 'received' ? message.from_email : lastReceived?.from_email ?? '';
      const toName = message.direction === 'received' ? (message.from_name ?? '') : (lastReceived?.from_name ?? '');
      setInReplyToMessageId(message.id);
      setReplyToEmail(toEmail);
      setReplyToName(toName);
      setReplySubject(selectedThread.subject?.startsWith('Re:') ? selectedThread.subject : `Re: ${selectedThread.subject || '(No subject)'}`);

      // Prefill CC from whole thread history (participants), excluding To and our sending identity
      const ourEmail = messages.find((m) => m.direction === 'sent')?.from_email?.trim().toLowerCase();
      const toNorm = toEmail.trim().toLowerCase();
      const ccSeen = new Set<string>();
      const ccList: string[] = [];
      for (const p of selectedThread.participants ?? []) {
        const e = p.trim();
        if (!e) continue;
        const n = e.toLowerCase();
        if (n === toNorm || n === ourEmail || ccSeen.has(n)) continue;
        ccSeen.add(n);
        ccList.push(e);
      }
      setReplyCc(ccList.join(', '));

      setComposerMode('reply');
    },
    [selectedThread, messages]
  );

  const openForwardComposer = useCallback(
    (_message: EmailMessage) => {
      if (!selectedThread) return;
      const subject = selectedThread.subject ?? '(No subject)';
      const fwdSubject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;
      setForwardedMessageId(_message.id);
      setForwardToEmail('');
      setForwardCc('');
      setForwardSubject(fwdSubject);
      setComposerMode('forward');
    },
    [selectedThread]
  );

  const handleFetchAttachmentBlob = useCallback(
    async (emailMessageId: string, part: string): Promise<Blob | null> => {
      if (!FETCH_ATTACHMENT_URL) return null;
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
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

  const winWidth = Dimensions.get('window').width;
  const REPLY_PANEL_WIDTH = Math.min(800, Math.max(520, winWidth * 0.58));
  const slideAnim = useRef(new Animated.Value(1)).current;

  const closeComposerPanel = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setComposerMode(null);
      setComposerAttachments([]);
      setComposerAttachmentsSkipMessage(null);
    });
  }, [slideAnim]);

  useEffect(() => {
    if (composerMode) {
      slideAnim.setValue(1);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [composerMode, slideAnim]);

  const retryFailedReply = useCallback(async () => {
    if (!accountId || !selectedThreadId || !selectedThread || !pendingReply || !pendingReply.isFailed) return;
    setSendingReply(true);
    try {
      const replyAttachments = pendingReply.attachments?.length
        ? pendingReply.attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
        : undefined;
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId: inReplyToMessageId!,
        subject: pendingReply.subject,
        bodyText: pendingReply.bodyText,
        bodyHtml: pendingReply.bodyHtml ?? pendingReply.bodyText,
        toEmail: pendingReply.toEmail,
        toName: pendingReply.toName ?? null,
        cc: pendingReply.cc?.length ? pendingReply.cc : undefined,
        attachments: replyAttachments,
      });
      const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
      const receivedAt = new Date().toISOString();
      setPendingReply({
        threadId: selectedThreadId,
        jobId,
        subject: pendingReply.subject,
        bodyText: pendingReply.bodyText,
        bodyHtml: pendingReply.bodyHtml,
        toEmail: pendingReply.toEmail,
        toName: pendingReply.toName,
        cc: pendingReply.cc,
        fromEmail,
        receivedAt,
        messageCountWhenPending: messages.length,
        inReplyToMessageId: pendingReply.inReplyToMessageId,
        attachments: pendingReply.attachments,
      });
      loadMessages(selectedThreadId);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        // Check job status for failures
        try {
          const jobStatus = await getMessageJobStatus(jobId);
          if (jobStatus) {
            if (jobStatus.status === 'failed') {
              setPendingReply((prev) =>
                prev && prev.jobId === jobId
                  ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                  : prev
              );
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (jobStatus.status === 'sent') {
              // Job succeeded, clear pending when message appears
              // (handled by the effect checking messages.length)
            }
          }
        } catch (err) {
          // Ignore errors checking job status, continue polling
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry reply');
    } finally {
      setSendingReply(false);
    }
  }, [accountId, selectedThreadId, selectedThread, pendingReply, messages, loadMessages, toast]);

  const sendReply = useCallback(async (skipBlockCheck?: boolean) => {
    if (!accountId || !selectedThreadId || !selectedThread || !inReplyToMessageId) return;
    if (!replyToEmail.trim()) {
      toast.error('To is required');
      return;
    }
    const totalAttachmentBytes = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
    if (totalAttachmentBytes > MAX_TOTAL_BYTES) {
      toast.error('Total attachment size exceeds 5 MB.');
      return;
    }
    const ccArray = replyCc.trim() ? replyCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : [];
    const allRecipients = [replyToEmail.trim(), ...ccArray];
    if (!skipBlockCheck && blockList.length > 0) {
      const anyBlocked = allRecipients.some((email) => isEmailBlockedByEntries(email, blockList));
      if (anyBlocked) {
        setBlockedRecipientConfirm({
          mode: 'reply',
          onConfirm: () => sendReply(true),
        });
        return;
      }
    }
    setSendingReply(true);
    try {
      const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
      const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;
      const replyAttachments =
        composerAttachments.length > 0
          ? composerAttachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
          : undefined;
      const jobId = await createReplyJob({
        accountId,
        threadId: selectedThreadId,
        inReplyToMessageId,
        subject: replySubject.trim() || '(No subject)',
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || '',
        toEmail: replyToEmail.trim(),
        toName: replyToName.trim() || null,
        cc: ccArray.length > 0 ? ccArray : undefined,
        attachments: replyAttachments,
      });
      const fromEmail = messages.find((m) => m.direction === 'sent')?.from_email ?? '';
      const receivedAt = new Date().toISOString();
      setPendingReply({
        threadId: selectedThreadId,
        jobId,
        subject: replySubject.trim() || '(No subject)',
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || '',
        toEmail: replyToEmail.trim(),
        toName: replyToName.trim() || null,
        cc: ccArray,
        fromEmail,
        receivedAt,
        messageCountWhenPending: messages.length,
        inReplyToMessageId,
        attachments: replyAttachments,
      });
      closeComposerPanel();
      loadMessages(selectedThreadId);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      pollingIntervalRef.current = setInterval(async () => {
        loadMessages(selectedThreadId, { silent: true });
        try {
          const jobStatus = await getMessageJobStatus(jobId);
          if (jobStatus?.status === 'failed') {
            setPendingReply((prev) =>
              prev && prev.jobId === jobId
                ? { ...prev, isFailed: true, errorMessage: jobStatus.error_message }
                : prev
            );
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to check job status:', err);
        }
      }, 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }, [accountId, selectedThreadId, selectedThread, inReplyToMessageId, replyToEmail, replyToName, replySubject, replyCc, composerAttachments, messages, blockList, loadMessages, closeComposerPanel, toast]);

  const sendForward = useCallback(async (skipBlockCheck?: boolean) => {
    if (!accountId || !selectedThreadId || !selectedThread || !forwardedMessageId) return;
    if (!forwardToEmail.trim()) {
      toast.error('To is required');
      return;
    }
    const totalAttachmentBytes = composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0);
    if (totalAttachmentBytes > MAX_TOTAL_BYTES) {
      toast.error('Total attachment size exceeds 5 MB.');
      return;
    }
    const ccArray = forwardCc.trim() ? forwardCc.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean) : [];
    const allRecipients = [forwardToEmail.trim(), ...ccArray];
    if (!skipBlockCheck && blockList.length > 0) {
      const anyBlocked = allRecipients.some((email) => isEmailBlockedByEntries(email, blockList));
      if (anyBlocked) {
        setBlockedRecipientConfirm({
          mode: 'forward',
          onConfirm: () => sendForward(true),
        });
        return;
      }
    }
    setSendingForward(true);
    try {
      const bodyText = (await composerEditorRef.current?.getText())?.trim() ?? '';
      const bodyHtml = (await composerEditorRef.current?.getHTML())?.trim() ?? bodyText;
      const forwardAttachments =
        composerAttachments.length > 0
          ? composerAttachments.map(({ filename, contentType, content }) => ({ filename, contentType, content }))
          : undefined;
      await createForwardJob({
        accountId,
        threadId: selectedThreadId,
        forwardedMessageId,
        subject: forwardSubject.trim() || '(No subject)',
        bodyText: bodyText || '',
        bodyHtml: bodyHtml || bodyText,
        toEmail: forwardToEmail.trim(),
        toName: null,
        cc: ccArray.length > 0 ? ccArray : undefined,
        attachments: forwardAttachments,
      });
      closeComposerPanel();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send forward');
    } finally {
      setSendingForward(false);
    }
  }, [accountId, selectedThreadId, selectedThread, forwardedMessageId, forwardToEmail, forwardSubject, forwardCc, composerAttachments, blockList, closeComposerPanel, toast]);

  return (
    <PageLayout scrollable={false}>
      <View className="flex-1 flex-row bg-[#121212]">
        {/* Threads + Message content (slides left when reply panel opens) */}
        <View style={{ flex: 1, minWidth: 0 }} className="flex-row">
        {/* Threads Panel - collapses when reply/forward panel is open */}
        <Animated.View
          className="border-r border-[#2A2A2A] bg-[#0D0D0D]"
          style={{
            width: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 384] }),
            overflow: 'hidden',
            borderRightWidth: 1,
          }}
        >
          <View className="px-4 py-4">
            <View className="flex-row items-center" style={{ minWidth: 0, gap: 10 }}>
              <View
                className="flex-1 flex-row items-center rounded-xl bg-[#1A1A1A] border border-[#2A2A2A] px-3 py-2.5"
                style={{ borderWidth: 1, minWidth: 0 }}
              >
                <MagnifyingGlassIcon size={20} color="#6B7280" style={{ marginRight: 10 }} />
                <TextInput
                  value={threadSearchQuery}
                  onChangeText={setThreadSearchQuery}
                  placeholder="Search conversations…"
                  placeholderTextColor="#6B7280"
                  className="flex-1 text-white font-instrument text-base py-0"
                  style={{ minHeight: 24 }}
                />
              </View>
              <View ref={filterButtonRef} collapsable={false} style={{ flexShrink: 0 }}>
                <Pressable
                  onPress={() => {
                    filterButtonRef.current?.measureInWindow((x, y, w, h) => {
                      setFilterAnchorLayout({ x, y, w, h });
                      setFilterMenuOpen(true);
                    });
                  }}
                  className="rounded-xl border items-center justify-center"
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: '#1A1A1A',
                    borderColor: '#2A2A2A',
                    borderWidth: 1,
                  }}
                >
                  <FunnelIcon
                    size={18}
                    color={hasActiveFilters ? '#F3440D' : '#9CA3AF'}
                  />
                </Pressable>
              </View>
            </View>
          </View>
          {threadsError && (
            <View className="px-4 py-3">
              <Alert
                variant="error"
                message={threadsError}
                actionText="Retry"
                onAction={() => loadThreads()}
              />
            </View>
          )}
          {(threadsLoadingOrNoAccount || showThreadSkeleton) ? (
            <ThreadListSkeleton />
          ) : threads.length === 0 && !threadsError ? (
            <EmptyState
              title="No conversations yet"
              description="Replies to your campaign emails will appear here."
              className="flex-1 px-5"
            />
          ) : displayThreads.length === 0 ? (
            <EmptyState
              title="No matching conversations"
              description="Try a different search term."
              className="flex-1 px-5"
            />
          ) : (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingTop: 0, paddingBottom: 6 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
              }
            >
              {displayThreads.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isSelected={selectedThreadId === thread.id}
                  onSelect={() => handleSelectThread(thread.id)}
                  isUnread={'unread_count' in thread ? (thread as { unread_count: number }).unread_count > 0 : false}
                  cardTitle={
                    (thread.lead_id && leadDisplayNamesMap[thread.lead_id]) ||
                    thread.participants?.[0] ||
                    thread.subject ||
                    '(No subject)'
                  }
                  campaignName={thread.campaign_id ? campaigns.find((c) => c.id === thread.campaign_id)?.name ?? null : null}
                  preview={threadSnippetsMap[thread.id] ?? null}
                  tags={threadTagsMap[thread.id] ?? []}
                />
              ))}
              {hasMoreThreads && (
                <Pressable
                  onPress={loadMoreThreads}
                  disabled={loadingMoreThreads}
                  className="mx-3 mt-1.5 mb-3 py-2.5 rounded-xl items-center"
                  style={{ backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A' }}
                >
                  <Text className="text-orange-500 font-instrument text-sm">
                    {loadingMoreThreads ? 'Loading…' : 'Load more'}
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </Animated.View>

        {/* Message Panel */}
        <View className="flex-1">
          {(threadsLoadingOrNoAccount || showThreadSkeleton) ? (
            <>
              <MessagePanelHeaderSkeleton />
              <MessageListSkeleton />
            </>
          ) : selectedThread ? (
            <>
              {(() => {
                const displayMessages: EmailMessage[] =
                  pendingReply && selectedThreadId === pendingReply.threadId
                    ? [
                        ...messages,
                        {
                          id: `pending-${pendingReply.jobId}`,
                          thread_id: selectedThreadId!,
                          message_job_id: pendingReply.jobId,
                          direction: 'sent' as const,
                          from_email: pendingReply.fromEmail,
                          from_name: null,
                          to_email: pendingReply.toEmail,
                          to_name: null,
                          cc: null,
                          subject: pendingReply.subject,
                          body_text: pendingReply.bodyText,
                          body_html: pendingReply.bodyHtml,
                          message_id: null,
                          in_reply_to: null,
                          message_references: null,
                          received_at: pendingReply.receivedAt,
                          read_at: null,
                          headers: {},
                          attachments: [],
                          imap_uid: null,
                          created_at: pendingReply.receivedAt,
                          updated_at: pendingReply.receivedAt,
                        },
                      ].sort(
                        (a, b) =>
                          new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
                      )
                    : messages;
                return (
                  <>
              <MessagePanelHeader
                prospectName={
                  (selectedThread?.lead_id && leadDisplayNamesMap[selectedThread.lead_id]) ||
                  selectedThreadProspectEmails[0] ||
                  null
                }
                campaignName={
                  selectedThread?.campaign_id
                    ? campaigns.find((c) => c.id === selectedThread.campaign_id)?.name ?? null
                    : null
                }
                prospectEmails={selectedThreadProspectEmails}
                blockedEmails={blockedProspectEmails}
                onBlock={accountId ? () => setBlockModalVisible(true) : undefined}
                showBlockButton={!!accountId && selectedThreadProspectEmails.length > 0}
                threadTags={selectedThreadId ? (threadTagsMap[selectedThreadId] ?? []) : []}
                onOpenTagsPanel={
                  selectedThreadId && accountId ? () => setTagsPanelVisible(true) : undefined
                }
                category={selectedThread?.category ?? null}
                onSetCategory={
                  selectedThreadId && accountId
                    ? async (cat) => {
                        try {
                          await updateThreadCategory(selectedThreadId, cat);
                          setThreads((prev) =>
                            prev.map((t) =>
                              t.id === selectedThreadId ? { ...t, category: cat } : t
                            )
                          );
                        } catch (e) {
                          console.error('Failed to update category:', e);
                        }
                      }
                    : undefined
                }
                categoryOptions={THREAD_CATEGORIES}
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
                <MessageListSkeleton />
              ) : (
                <ScrollView
                  ref={messagesScrollViewRef}
                  onContentSizeChange={(_w, h) => {
                    const shouldAutoScroll = autoScrollArmedRef.current;
                    if (shouldAutoScroll) {
                      autoScrollArmedRef.current = false;
                      scrollMessagesToEnd('content-size-change', h);
                      return;
                    }
                    if (lastContentHeightRef.current !== h) {
                      lastContentHeightRef.current = h;
                    }
                  }}
                  className="flex-1 bg-[#121212]"
                  contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 }}
                  showsVerticalScrollIndicator={false}
                >
                  {groupMessagesByDate(displayMessages).map((group) => (
                    <View key={group.label}>
                      <DateDivider label={group.label} />
                      {group.messages.map((message) => {
                        const isPendingMessage = message.id.startsWith('pending-');
                        const pendingInfo = isPendingMessage && pendingReply && selectedThreadId === pendingReply.threadId
                          ? pendingReply
                          : null;
                        return (
                          <MessageBubble
                            key={message.id}
                            message={message}
                            onReply={openReplyComposer}
                            onForward={openForwardComposer}
                            onDownloadAttachment={FETCH_ATTACHMENT_URL ? handleDownloadAttachment : undefined}
                            onFetchAttachmentPreview={FETCH_ATTACHMENT_URL ? handleFetchAttachmentBlob : undefined}
                            isPending={isPendingMessage && !pendingInfo?.isFailed}
                            isFailed={pendingInfo?.isFailed ?? false}
                            errorMessage={pendingInfo?.errorMessage}
                            onRetry={pendingInfo?.isFailed ? retryFailedReply : undefined}
                          />
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              )}
                  </>
                );
              })()}
            </>
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
        </View>

        {/* Filter dropdown */}
        <InboxFilterDropdown
          visible={filterMenuOpen}
          onClose={() => setFilterMenuOpen(false)}
          anchorLayout={filterAnchorLayout}
          unreadOnlyFilter={unreadOnlyFilter}
          onUnreadOnlyFilterChange={setUnreadOnlyFilter}
          datePreset={datePreset}
          onDatePresetChange={setDatePreset}
          mailboxFilterId={mailboxFilterId}
          onMailboxFilterIdChange={setMailboxFilterId}
          campaignFilterId={campaignFilterId}
          onCampaignFilterIdChange={setCampaignFilterId}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          tagFilterIds={tagFilterIds}
          onTagFilterIdsChange={setTagFilterIds}
          mailboxes={mailboxes}
          campaigns={campaigns}
          accountTags={accountTags}
          onClearAll={() => {
            setMailboxFilterId(null);
            setCampaignFilterId(null);
            setUnreadOnlyFilter(false);
            setDatePreset(null);
            setTagFilterIds([]);
            setCategoryFilter(null);
          }}
        />

        {/* Block sender modal */}
        {accountId && (
          <BlockSenderModal
            visible={blockModalVisible}
            onClose={() => setBlockModalVisible(false)}
            participantEmails={selectedThreadProspectEmails}
            accountId={accountId}
            onBlocked={loadBlockList}
          />
        )}

        {/* Tags panel */}
        {accountId && selectedThreadId && (
          <TagsPanelModal
            visible={tagsPanelVisible}
            onClose={() => setTagsPanelVisible(false)}
            threadTags={threadTagsMap[selectedThreadId] ?? []}
            accountTags={accountTags}
            onAddTag={async (tag) => {
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
                console.error('Failed to add tag:', e);
              }
            }}
            onRemoveTag={async (tag) => {
              try {
                await removeTagFromThread(selectedThreadId, tag.id);
                setThreadTagsMap((prev) => ({
                  ...prev,
                  [selectedThreadId]: (prev[selectedThreadId] ?? []).filter((t) => t.id !== tag.id),
                }));
              } catch (e) {
                console.error('Failed to remove tag:', e);
              }
            }}
            onUpdateTag={(updated) => {
              setAccountTags((p) => p.map((t) => (t.id === updated.id ? updated : t)));
              setThreadTagsMap((prev) => ({
                ...prev,
                [selectedThreadId]: (prev[selectedThreadId] ?? []).map((t) =>
                  t.id === updated.id ? updated : t
                ),
              }));
            }}
            onDeleteTag={(deleted) => {
              setAccountTags((p) => p.filter((t) => t.id !== deleted.id));
              setThreadTagsMap((prev) => {
                const next = { ...prev };
                for (const threadId of Object.keys(next)) {
                  next[threadId] = (next[threadId] ?? []).filter((t) => t.id !== deleted.id);
                }
                return next;
              });
            }}
            onCreateTag={() => {
              setTagsPanelVisible(false);
              setCreateTagModalVisible(true);
            }}
          />
        )}

        {/* Create tag modal */}
        {accountId && (
          <CreateTagModal
            visible={createTagModalVisible}
            onClose={() => setCreateTagModalVisible(false)}
            accountId={accountId}
            onCreated={async (tag) => {
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
            }}
          />
        )}

        {/* Confirmation when sending to blocked recipient */}
        {blockedRecipientConfirm && (
          <ConfirmDeleteModal
            visible={!!blockedRecipientConfirm}
            onClose={() => setBlockedRecipientConfirm(null)}
            onConfirm={async () => {
              blockedRecipientConfirm.onConfirm();
              setBlockedRecipientConfirm(null);
            }}
            title="Send to blocked address?"
            description="This lead has been blocked. No automatic emails will be sent to them, but you can send messages to them manually without unblocking if you wish. Confirm to proceed."
            confirmLabel="Send anyway"
            cancelLabel="Cancel"
            requireConfirmation={false}
          />
        )}

        {/* Reply/Forward composer: right-side panel (slides in, pushes content left) */}
        {composerMode && (
          <Animated.View
            style={{
              width: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [REPLY_PANEL_WIDTH, 0],
              }),
              overflow: 'hidden',
              backgroundColor: '#1A1A1A',
              borderLeftWidth: 1,
              borderLeftColor: '#2A2A2A',
            }}
          >
            <View style={{ width: REPLY_PANEL_WIDTH, flex: 1 }}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
              >
                <View className="flex-1 p-5">
                  <View className="flex-row justify-between items-center mb-5 pb-3 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }}>
                    <Text className="text-xl font-instrument-semibold text-white">
                      {composerMode === 'reply' ? 'Reply' : 'Forward'}
                    </Text>
                    <Pressable
                      onPress={closeComposerPanel}
                      className="rounded-xl border border-[#3A3A3A] px-4 py-2"
                    >
                      <Text className="text-gray-300 font-instrument-medium text-sm">Cancel</Text>
                    </Pressable>
                  </View>
                  {composerMode === 'reply' ? (
                    <>
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="flex-1 pb-4">
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
                        <TextInput
                          value={replyToEmail}
                          onChangeText={setReplyToEmail}
                          placeholder="recipient@example.com"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
                        <Text className="text-gray-500 font-instrument text-xs mb-1">Separate multiple addresses with commas or spaces.</Text>
                        <TextInput
                          value={replyCc}
                          onChangeText={setReplyCc}
                          placeholder="cc@example.com, other@example.com"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Subject</Text>
                        <TextInput
                          value={replySubject}
                          onChangeText={setReplySubject}
                          placeholder="Subject"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
                        <ComposerRichEditor
                          key="reply"
                          initialContent="<p></p>"
                          placeholder="Write your reply…"
                          editorRef={composerEditorRef}
                          minHeight={140}
                          attachmentCount={composerAttachments.length}
                          onFilesSelected={handleComposerFilesSelected}
                          renderBetweenToolbarAndContent={
                            <ComposerAttachments
                              attachments={composerAttachments}
                              onAttachmentsChange={setComposerAttachments}
                              maxFiles={MAX_ATTACHMENTS}
                              maxTotalBytes={MAX_TOTAL_BYTES}
                              maxFileBytes={MAX_FILE_BYTES}
                              hideTrigger={Platform.OS === 'web'}
                              loading={composerAttachmentsLoading}
                              skipMessage={composerAttachmentsSkipMessage}
                              error={
                                composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0) > MAX_TOTAL_BYTES
                                  ? 'Total attachment size exceeds 5 MB.'
                                  : null
                              }
                            />
                          }
                        />
                        <View className="mb-5" />
                        <Button
                          onPress={() => sendReply()}
                          disabled={
                            sendingReply ||
                            !replyToEmail.trim() ||
                            composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0) > MAX_TOTAL_BYTES
                          }
                          className="rounded-xl"
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="font-instrument-medium text-base text-white">
                              {sendingReply ? 'Sending…' : 'Send reply'}
                            </Text>
                            <PaperAirplaneIcon size={18} color="white" />
                          </View>
                        </Button>
                      </ScrollView>
                    </>
                  ) : (
                    <>
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} className="flex-1 pb-4">
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">To</Text>
                        <TextInput
                          value={forwardToEmail}
                          onChangeText={setForwardToEmail}
                          placeholder="recipient@example.com"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Cc (optional)</Text>
                        <TextInput
                          value={forwardCc}
                          onChangeText={setForwardCc}
                          placeholder="cc@example.com, other@example.com"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Subject</Text>
                        <TextInput
                          value={forwardSubject}
                          onChangeText={setForwardSubject}
                          placeholder="Subject"
                          placeholderTextColor="#6B7280"
                          className="bg-[#2A2A2A] text-white font-instrument rounded-xl px-4 py-3 mb-4 border border-[#2A2A2A]"
                          style={{ borderWidth: 1 }}
                        />
                        <Text className="text-gray-400 font-instrument-medium text-sm mb-1.5">Message</Text>
                        <Text className="text-gray-500 font-instrument text-xs mb-1">Add your message above the forwarded content.</Text>
                        <ComposerRichEditor
                          key="forward"
                          initialContent={`<p></p>${buildQuotedForwardThreadHtml(messages, selectedThread?.subject ?? '(No subject)')}`}
                          placeholder="Write your message…"
                          editorRef={composerEditorRef}
                          minHeight={140}
                          attachmentCount={composerAttachments.length}
                          onFilesSelected={handleComposerFilesSelected}
                          renderBetweenToolbarAndContent={
                            <ComposerAttachments
                              attachments={composerAttachments}
                              onAttachmentsChange={setComposerAttachments}
                              maxFiles={MAX_ATTACHMENTS}
                              maxTotalBytes={MAX_TOTAL_BYTES}
                              maxFileBytes={MAX_FILE_BYTES}
                              hideTrigger={Platform.OS === 'web'}
                              loading={composerAttachmentsLoading}
                              skipMessage={composerAttachmentsSkipMessage}
                              error={
                                composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0) > MAX_TOTAL_BYTES
                                  ? 'Total attachment size exceeds 5 MB.'
                                  : null
                              }
                            />
                          }
                        />
                        <View className="mb-5" />
                        <Button
                          onPress={() => sendForward()}
                          disabled={
                            sendingForward ||
                            !forwardToEmail.trim() ||
                            composerAttachments.reduce((s, a) => s + (a.size ?? 0), 0) > MAX_TOTAL_BYTES
                          }
                          className="rounded-xl"
                        >
                          <View className="flex-row items-center gap-2">
                            <Text className="font-instrument-medium text-base text-white">
                              {sendingForward ? 'Sending…' : 'Send forward'}
                            </Text>
                            <PaperAirplaneIcon size={18} color="white" />
                          </View>
                        </Button>
                      </ScrollView>
                    </>
                  )}
                </View>
              </KeyboardAvoidingView>
            </View>
          </Animated.View>
        )}
      </View>
    </PageLayout>
  );
}
