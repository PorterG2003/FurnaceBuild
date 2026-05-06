import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from 'react-native';
import { useSmoothLoading } from '@/components/ui/feedback';
import {
  getThreadsByAccount,
  getThreadById,
  getMessagesByThread,
  getBlockList,
  isEmailBlockedByEntries,
  markThreadMessagesRead,
  getMailboxesByAccount,
  getCampaigns,
  getThreadTags,
  getTagsForThreads,
  getThreadSnippets,
  getLeadsByIds,
  getLeadReplacementSummariesByLeadIds,
} from '@/lib/supabase/services';
import { getLeadDisplayName } from '@/lib/leads';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { EmailThread, EmailMessage, BlockListEntry, Mailbox, Campaign, Lead } from '@/lib/supabase/types';
import { THREAD_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '@/components/inbox/inboxConstants';

export interface UseInboxDataOptions {
  accountId: string | null;
  /** When false, never auto-open the first thread after load/refresh (mobile list-first UX). */
  autoSelectFirstThread?: boolean;
  /**
   * Current `?thread=` from the route. After a list reload, if selection state was lost
   * but this id is still in the list, open it instead of defaulting to the first thread.
   */
  routeThreadId?: string | null;
  /** Called when `routeThreadId` is set but the thread cannot be loaded for this account. */
  onRouteThreadUnavailable?: () => void;
}

export function useInboxData({
  accountId,
  autoSelectFirstThread = true,
  routeThreadId = null,
  onRouteThreadUnavailable,
}: UseInboxDataOptions) {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [mailboxFilterId, setMailboxFilterId] = useState<string | null>(null);
  const [campaignFilterId, setCampaignFilterId] = useState<string | null>(null);
  const [unreadOnlyFilter, setUnreadOnlyFilter] = useState(false);
  const [datePreset, setDatePreset] = useState<'7d' | '30d' | null>(null);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [includeOutOfOfficeFilter, setIncludeOutOfOfficeFilter] = useState(false);
  const [threadOffset, setThreadOffset] = useState(0);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [blockList, setBlockList] = useState<BlockListEntry[]>([]);
  const [threadTagsMap, setThreadTagsMap] = useState<Record<string, ThreadTag[]>>({});
  const [threadSnippetsMap, setThreadSnippetsMap] = useState<Record<string, string>>({});
  const [leadDisplayNamesMap, setLeadDisplayNamesMap] = useState<Record<string, string>>({});
  const [leadByIdMap, setLeadByIdMap] = useState<Record<string, Lead>>({});
  const [leadReplacementSummaryMap, setLeadReplacementSummaryMap] = useState<Record<string, LeadReplacementSummary>>({});
  const [accountTags, setAccountTags] = useState<ThreadTag[]>([]);

  const filterButtonRef = useRef<View>(null);
  const loadThreadsRef = useRef<(options?: { append?: boolean }) => Promise<void>>(() => Promise.resolve());
  const initialLoadDoneRef = useRef<string | null>(null);
  const filtersEffectRanRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeThreadDeepLinkAttemptRef = useRef<string | null>(null);

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const threadsLoadingOrNoAccount = threadsLoading || !accountId;
  const showThreadSkeleton = useSmoothLoading(threadsLoadingOrNoAccount);
  const showMessagesSkeleton = useSmoothLoading(messagesLoading);

  const displayThreads = threads;
  const hasActiveFilters =
    !!mailboxFilterId ||
    !!campaignFilterId ||
    unreadOnlyFilter ||
    !!datePreset ||
    tagFilterIds.length > 0 ||
    !!categoryFilter ||
    includeOutOfOfficeFilter ||
    threadSearchQuery.trim().length > 0;

  const selectedThreadProspectEmails = useMemo(() => {
    if (!selectedThreadId) return [];
    const emails: string[] = [];
    const seen = new Set<string>();
    const currentLeadEmail = selectedThread?.lead_id ? leadByIdMap[selectedThread.lead_id]?.email ?? null : null;
    const candidateEmails = [
      currentLeadEmail,
      ...messages.filter((m) => m.direction === 'received').map((m) => m.from_email),
    ];

    for (const email of candidateEmails) {
      const normalized = email?.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      emails.push(email!.trim());
    }

    return emails;
  }, [selectedThreadId, selectedThread?.lead_id, leadByIdMap, messages]);

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
      includeOutOfOffice: includeOutOfOfficeFilter ? true : undefined,
    };
  }, [
    mailboxFilterId,
    campaignFilterId,
    unreadOnlyFilter,
    datePreset,
    threadSearchQuery,
    tagFilterIds,
    categoryFilter,
    includeOutOfOfficeFilter,
  ]);

  const loadBlockList = useCallback(async () => {
    if (!accountId) return;
    try {
      const list = await getBlockList(accountId);
      setBlockList(list);
    } catch (err) {
      console.error('Failed to load block list:', err);
    }
  }, [accountId]);

  const loadMessages = useCallback(async (threadId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setMessagesError(null);
      setMessagesLoading(true);
    }
    try {
      const [list] = await Promise.all([
        getMessagesByThread(threadId),
        loadBlockList(),
      ]);
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
  }, [loadBlockList]);

  const loadThreads = useCallback(
    async (options?: { append?: boolean }) => {
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
            setSelectedThreadId((prev) => {
              const stillInList = prev && list.some((t) => t.id === prev);
              if (stillInList) return prev;
              const fromRoute =
                routeThreadId && list.some((t) => t.id === routeThreadId)
                  ? routeThreadId
                  : null;
              if (fromRoute) return fromRoute;
              if (autoSelectFirstThread) return list[0].id;
              return null;
            });
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
    },
    [accountId, buildThreadFilters, threadOffset, autoSelectFirstThread, routeThreadId]
  );
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
      } else {
        setSelectedThreadId((prev) => {
          const stillInList = prev && list.some((t) => t.id === prev);
          if (stillInList) return prev;
          const fromRoute =
            routeThreadId && list.some((t) => t.id === routeThreadId)
              ? routeThreadId
              : null;
          if (fromRoute) return fromRoute;
          if (autoSelectFirstThread) return list[0].id;
          return null;
        });
      }
    } finally {
      setRefreshing(false);
    }
  }, [accountId, buildThreadFilters, loadBlockList, autoSelectFirstThread, routeThreadId]);

  const handleSelectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
    markThreadMessagesRead(threadId).catch((err) => console.error('Failed to mark thread as read:', err));
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId && 'unread_count' in t ? { ...t, unread_count: 0 } : t))
    );
  }, []);

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

  useEffect(() => {
    if (!routeThreadId) {
      routeThreadDeepLinkAttemptRef.current = null;
      return;
    }
    if (!accountId || threadsLoading) return;
    if (threads.some((t) => t.id === routeThreadId)) {
      routeThreadDeepLinkAttemptRef.current = null;
      return;
    }
    if (routeThreadDeepLinkAttemptRef.current === routeThreadId) return;
    routeThreadDeepLinkAttemptRef.current = routeThreadId;

    let cancelled = false;
    void getThreadById(routeThreadId)
      .then((row) => {
        if (cancelled) return;
        if (row && row.account_id === accountId) {
          setThreads((prev) => {
            if (prev.some((t) => t.id === row.id)) return prev;
            const withUnread = { ...row, unread_count: 0 };
            return [withUnread, ...prev.filter((t) => t.id !== row.id)];
          });
        } else {
          onRouteThreadUnavailable?.();
        }
      })
      .catch(() => {
        if (!cancelled) onRouteThreadUnavailable?.();
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, threadsLoading, routeThreadId, threads, onRouteThreadUnavailable]);

  useEffect(() => {
    if (threads.length === 0) {
      setThreadTagsMap({});
      setThreadSnippetsMap({});
      setLeadDisplayNamesMap({});
      setLeadByIdMap({});
      setLeadReplacementSummaryMap({});
      return;
    }
    const ids = threads.map((t) => t.id);
    const leadIds = [...new Set(threads.map((t) => t.lead_id).filter(Boolean))] as string[];
    Promise.all([
      getTagsForThreads(ids),
      getThreadSnippets(ids),
      leadIds.length > 0 ? getLeadsByIds(leadIds) : Promise.resolve([]),
      leadIds.length > 0 ? getLeadReplacementSummariesByLeadIds(leadIds) : Promise.resolve({}),
    ])
      .then(([tags, snippets, leads, replacementSummaries]) => {
        setThreadTagsMap(tags);
        setThreadSnippetsMap(snippets);
        const leadNames: Record<string, string> = {};
        const leadRecords: Record<string, Lead> = {};
        for (const lead of leads) {
          const name = getLeadDisplayName(lead);
          if (name) leadNames[lead.id] = name;
          leadRecords[lead.id] = lead;
        }
        setLeadDisplayNamesMap(leadNames);
        setLeadByIdMap(leadRecords);
        setLeadReplacementSummaryMap(replacementSummaries);
      })
      .catch((err) => console.error('Failed to load thread tags/snippets/leads:', err));
  }, [threads]);

  useEffect(() => {
    if (!accountId) return;
    if (!filtersEffectRanRef.current) {
      filtersEffectRanRef.current = true;
      return;
    }
    setThreadOffset(0);
    loadThreadsRef.current();
  }, [
    accountId,
    mailboxFilterId,
    campaignFilterId,
    unreadOnlyFilter,
    datePreset,
    tagFilterIds,
    categoryFilter,
    includeOutOfOfficeFilter,
  ]);

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

  useEffect(() => {
    if (selectedThreadId) {
      loadMessages(selectedThreadId);
    } else {
      setMessages([]);
    }
  }, [selectedThreadId, loadMessages]);

  return {
    threads,
    setThreads,
    messages,
    setMessages,
    selectedThreadId,
    setSelectedThreadId,
    selectedThread,
    threadsLoading,
    threadsError,
    messagesLoading,
    messagesError,
    refreshing,
    threadSearchQuery,
    setThreadSearchQuery,
    mailboxFilterId,
    setMailboxFilterId,
    campaignFilterId,
    setCampaignFilterId,
    unreadOnlyFilter,
    setUnreadOnlyFilter,
    datePreset,
    setDatePreset,
    tagFilterIds,
    setTagFilterIds,
    categoryFilter,
    setCategoryFilter,
    includeOutOfOfficeFilter,
    setIncludeOutOfOfficeFilter,
    threadOffset,
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
    displayThreads,
    hasActiveFilters,
    threadsLoadingOrNoAccount,
    showThreadSkeleton,
    showMessagesSkeleton,
    selectedThreadProspectEmails,
    blockedProspectEmails,
    filterButtonRef,
    loadThreads,
    loadMessages,
    loadMoreThreads,
    handleRefresh,
    handleSelectThread,
    loadBlockList,
  };
}
