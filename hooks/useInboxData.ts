import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { View } from 'react-native';
import {
  getThreadsByAccount,
  getMessagesByThread,
  getBlockList,
  isEmailBlockedByEntries,
  markThreadMessagesRead,
  getMailboxesByAccount,
  getCampaigns,
  getThreadTags,
  getCampaignTags,
  getTagsForThreads,
  getThreadSnippets,
  getLeadsByIds,
  getLeadReplacementSummariesByLeadIds,
  getThreadById,
} from '@/lib/supabase/services';
import { resolveSelectedThread } from '@/lib/inbox/resolveSelectedThread';
import { getLeadDisplayName } from '@/lib/leads';
import { normalizeInboxSearchQuery } from '@/lib/inbox';
import type { LeadReplacementSummary } from '@/lib/supabase/services/leads';
import type { CampaignTag } from '@/lib/supabase/services/campaign-tags';
import type { ThreadTag } from '@/lib/supabase/services/thread-tags';
import type { EmailThread, EmailMessage, BlockListEntry, Mailbox, Campaign, Lead } from '@/lib/supabase/types';
import type { InboxThreadSortBy } from '@/lib/supabase/services/inbox';
import { THREAD_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '@/components/inbox/inboxConstants';

export interface UseInboxDataOptions {
  accountId: string | null;
  /** Thread id from route path; null when at `/inbox`. */
  selectedThreadId: string | null;
  /** Thread row already loaded by route access validation. */
  routeValidatedThread?: EmailThread | null;
}

export function useInboxData({
  accountId,
  selectedThreadId,
  routeValidatedThread = null,
}: UseInboxDataOptions) {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoadedForThreadId, setMessagesLoadedForThreadId] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [threadSearchQuery, setThreadSearchQueryState] = useState('');
  const [mailboxFilterId, setMailboxFilterIdState] = useState<string | null>(null);
  const [campaignFilterId, setCampaignFilterIdState] = useState<string | null>(null);
  const [unreadOnlyFilter, setUnreadOnlyFilterState] = useState(false);
  const [datePreset, setDatePresetState] = useState<'7d' | '30d' | null>(null);
  const [tagFilterIds, setTagFilterIdsState] = useState<string[]>([]);
  const [campaignTagFilterIds, setCampaignTagFilterIdsState] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilterState] = useState<string | null>(null);
  const [conversationStatusFilter, setConversationStatusFilterState] = useState<'open' | 'closed' | 'all'>('all');
  const [sortBy, setSortByState] = useState<InboxThreadSortBy>('newest');
  const [threadOffset, setThreadOffset] = useState(0);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [threadsTotalCount, setThreadsTotalCount] = useState(0);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [initialThreadsLoadSettled, setInitialThreadsLoadSettled] = useState(false);
  const [fetchedSelectedThread, setFetchedSelectedThread] = useState<EmailThread | null>(null);

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [blockList, setBlockList] = useState<BlockListEntry[]>([]);
  const [threadTagsMap, setThreadTagsMap] = useState<Record<string, ThreadTag[]>>({});
  const [threadSnippetsMap, setThreadSnippetsMap] = useState<Record<string, string>>({});
  const [leadDisplayNamesMap, setLeadDisplayNamesMap] = useState<Record<string, string>>({});
  const [leadByIdMap, setLeadByIdMap] = useState<Record<string, Lead>>({});
  const [leadReplacementSummaryMap, setLeadReplacementSummaryMap] = useState<Record<string, LeadReplacementSummary>>({});
  const [accountTags, setAccountTags] = useState<ThreadTag[]>([]);
  const [accountCampaignTags, setAccountCampaignTags] = useState<CampaignTag[]>([]);

  const filterButtonRef = useRef<View>(null);
  const loadThreadsRef = useRef<(options?: { append?: boolean }) => Promise<void>>(() => Promise.resolve());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const initialLoadDoneRef = useRef<string | null>(null);
  const filtersEffectRanRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAccountIdRef = useRef<string | null>(null);
  const prevSearchAccountIdRef = useRef<string | null>(null);

  const threadIdsKey = useMemo(
    () => [...threads.map((thread) => `${thread.id}:${thread.lead_id ?? ''}`)].sort().join(','),
    [threads]
  );

  const selectedThreadInList = useMemo(
    () => (selectedThreadId ? threads.find((t) => t.id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );

  const pinnedSelectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    if (routeValidatedThread?.id === selectedThreadId) return routeValidatedThread;
    if (fetchedSelectedThread?.id === selectedThreadId) return fetchedSelectedThread;
    return null;
  }, [selectedThreadId, routeValidatedThread, fetchedSelectedThread]);

  const selectedThread = useMemo(
    () => resolveSelectedThread(threads, selectedThreadId, pinnedSelectedThread),
    [threads, selectedThreadId, pinnedSelectedThread],
  );

  useEffect(() => {
    if (!selectedThreadId || !accountId) {
      if (!selectedThreadId) setFetchedSelectedThread(null);
      return;
    }

    if (selectedThreadInList) {
      setFetchedSelectedThread(null);
      return;
    }

    if (routeValidatedThread?.id === selectedThreadId) return;
    if (fetchedSelectedThread?.id === selectedThreadId) return;

    let cancelled = false;
    void getThreadById(selectedThreadId)
      .then((thread) => {
        if (!cancelled) setFetchedSelectedThread(thread);
      })
      .catch((err) => console.error('Failed to fetch selected thread:', err));

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    selectedThreadId,
    selectedThreadInList,
    routeValidatedThread,
    fetchedSelectedThread?.id,
  ]);

  const displayThreads = threads;
  const hasActiveFilters =
    !!mailboxFilterId ||
    !!campaignFilterId ||
    unreadOnlyFilter ||
    !!datePreset ||
    tagFilterIds.length > 0 ||
    campaignTagFilterIds.length > 0 ||
    !!categoryFilter ||
    conversationStatusFilter !== 'all' ||
    !!normalizeInboxSearchQuery(threadSearchQuery);

  const clearAllFilters = useCallback(() => {
    setThreadSearchQueryState('');
    setMailboxFilterIdState(null);
    setCampaignFilterIdState(null);
    setUnreadOnlyFilterState(false);
    setDatePresetState(null);
    setTagFilterIdsState([]);
    setCampaignTagFilterIdsState([]);
    setCategoryFilterState(null);
    setConversationStatusFilterState('all');
    setSortByState('newest');
  }, []);

  const resetForAccountChange = useCallback(() => {
    clearAllFilters();
    setThreads([]);
    setMessages([]);
    setMessagesLoadedForThreadId(null);
    setThreadOffset(0);
    setHasMoreThreads(false);
    setThreadsTotalCount(0);
    setThreadsError(null);
    setMessagesError(null);
    filtersEffectRanRef.current = false;
    initialLoadDoneRef.current = null;
    setInitialThreadsLoadSettled(false);
  }, [clearAllFilters]);

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
      searchQuery: normalizeInboxSearchQuery(threadSearchQuery) ?? undefined,
      tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
      campaignTagIds: campaignTagFilterIds.length > 0 ? campaignTagFilterIds : undefined,
      category: categoryFilter ?? undefined,
      conversationStatus: conversationStatusFilter,
      sortBy,
    };
  }, [
    mailboxFilterId,
    campaignFilterId,
    unreadOnlyFilter,
    datePreset,
    threadSearchQuery,
    tagFilterIds,
    campaignTagFilterIds,
    categoryFilter,
    conversationStatusFilter,
    sortBy,
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
        setMessagesLoadedForThreadId(threadId);
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
        const { threads: list, totalCount } = await getThreadsByAccount(accountId, opts);
        setThreadsTotalCount(totalCount);
        if (append) {
          setThreads((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newThreads = list.filter((t) => !existingIds.has(t.id));
            return [...prev, ...newThreads];
          });
          const nextOffset = offset + list.length;
          setThreadOffset(nextOffset);
          setHasMoreThreads(nextOffset < totalCount);
        } else {
          setThreads(list);
          setThreadOffset(list.length);
          setHasMoreThreads(list.length < totalCount);
        }
      } catch (err) {
        if (!append) {
          setThreadsError(err instanceof Error ? err.message : 'Failed to load conversations');
        }
      } finally {
        if (!append) {
          setInitialThreadsLoadSettled(true);
        }
        setThreadsLoading(false);
        setLoadingMoreThreads(false);
      }
    },
    [accountId, buildThreadFilters, threadOffset]
  );
  loadThreadsRef.current = loadThreads;

  const loadMoreThreads = useCallback(() => {
    loadThreads({ append: true });
  }, [loadThreads]);

  const loadMailboxesAndCampaigns = useCallback(async () => {
    if (!accountId) return;
    try {
      const [mbList, campList, tagsList, campaignTagsList] = await Promise.all([
        getMailboxesByAccount(accountId),
        getCampaigns({ accountId }),
        getThreadTags(accountId),
        getCampaignTags(accountId),
      ]);
      setMailboxes(mbList);
      setCampaigns(campList);
      setAccountTags(tagsList);
      setAccountCampaignTags(campaignTagsList);
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
      const [{ threads: list, totalCount }] = await Promise.all([
        getThreadsByAccount(accountId, opts),
        loadBlockList(),
      ]);
      setThreads(list);
      setThreadOffset(list.length);
      setThreadsTotalCount(totalCount);
      setHasMoreThreads(list.length < totalCount);
    } finally {
      setRefreshing(false);
    }
  }, [accountId, buildThreadFilters, loadBlockList]);

  const markThreadReadOptimistic = useCallback((threadId: string) => {
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
      prevAccountIdRef.current = null;
      setInitialThreadsLoadSettled(false);
      return;
    }

    if (prevAccountIdRef.current != null && prevAccountIdRef.current !== accountId) {
      resetForAccountChange();
    }
    prevAccountIdRef.current = accountId;

    if (initialLoadDoneRef.current === accountId) return;
    initialLoadDoneRef.current = accountId;
    loadMailboxesAndCampaigns();
    loadThreads();
    loadBlockList();
  }, [accountId, loadThreads, loadBlockList, loadMailboxesAndCampaigns, resetForAccountChange]);

  useEffect(() => {
    if (!threadIdsKey) {
      setThreadTagsMap({});
      setThreadSnippetsMap({});
      setLeadDisplayNamesMap({});
      setLeadByIdMap({});
      setLeadReplacementSummaryMap({});
      return;
    }
    const snapshot = threadsRef.current;
    const ids = snapshot.map((thread) => thread.id);
    const leadIds = [...new Set(snapshot.map((thread) => thread.lead_id).filter(Boolean))] as string[];
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
  }, [threadIdsKey]);

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
    campaignTagFilterIds,
    categoryFilter,
    conversationStatusFilter,
    sortBy,
  ]);

  useEffect(() => {
    if (!accountId) {
      prevSearchAccountIdRef.current = null;
      return;
    }
    const accountJustChanged = prevSearchAccountIdRef.current !== accountId;
    prevSearchAccountIdRef.current = accountId;

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Account mount/switch already loads threads in the account effect.
    if (accountJustChanged && threadSearchQuery.trim() === '') {
      return;
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

  const prevSelectedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedThreadId) {
      if (prevSelectedThreadIdRef.current !== null) {
        setMessages([]);
        setMessagesLoadedForThreadId(null);
        prevSelectedThreadIdRef.current = null;
      }
      return;
    }

    if (
      prevSelectedThreadIdRef.current === selectedThreadId &&
      messagesLoadedForThreadId === selectedThreadId
    ) {
      return;
    }

    prevSelectedThreadIdRef.current = selectedThreadId;
    setMessages([]);
    setMessagesLoadedForThreadId(null);
    loadMessages(selectedThreadId);
  }, [selectedThreadId, loadMessages, messagesLoadedForThreadId]);

  return {
    threads,
    setThreads,
    messages,
    setMessages,
    selectedThreadId,
    selectedThread,
    threadsLoading,
    threadsError,
    initialThreadsLoadSettled,
    messagesLoading,
    messagesLoadedForThreadId,
    messagesError,
    refreshing,
    threadSearchQuery,
    setThreadSearchQuery: setThreadSearchQueryState,
    mailboxFilterId,
    setMailboxFilterId: setMailboxFilterIdState,
    campaignFilterId,
    setCampaignFilterId: setCampaignFilterIdState,
    unreadOnlyFilter,
    setUnreadOnlyFilter: setUnreadOnlyFilterState,
    datePreset,
    setDatePreset: setDatePresetState,
    tagFilterIds,
    setTagFilterIds: setTagFilterIdsState,
    campaignTagFilterIds,
    setCampaignTagFilterIds: setCampaignTagFilterIdsState,
    categoryFilter,
    setCategoryFilter: setCategoryFilterState,
    conversationStatusFilter,
    setConversationStatusFilter: setConversationStatusFilterState,
    sortBy,
    setSortBy: setSortByState,
    threadOffset,
    hasMoreThreads,
    threadsTotalCount,
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
  };
}
