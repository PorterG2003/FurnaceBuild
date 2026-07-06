'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { useAccount } from '@/contexts/AccountContext';
import {
  getOpenConversationCount,
  getOpenConversationCountsByAccountIds,
} from '@/lib/supabase/services/inbox/openConversationCounts';
import { supabase } from '@/lib/supabase/client';

const FALLBACK_POLL_MS = 5 * 60 * 1000;
const REFRESH_DEBOUNCE_MS = 300;
const ACCOUNT_REFRESH_DEBOUNCE_MS = 150;

interface OpenConversationCountsContextValue {
  countsByAccountId: Record<string, number>;
  currentCount: number;
  refresh: () => void;
  adjustCount: (accountId: string, delta: number) => void;
}

const OpenConversationCountsContext = createContext<OpenConversationCountsContextValue | null>(null);

function isDocumentVisible(): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

export function OpenConversationCountsProvider({ children }: { children: React.ReactNode }) {
  const { memberships, account, user } = useAccount();
  const accountIds = useMemo(
    () => memberships.map((membership) => membership.account.id),
    [memberships],
  );
  const accountIdsKey = accountIds.join(',');

  const [countsByAccountId, setCountsByAccountId] = useState<Record<string, number>>({});
  const fetchGenerationRef = useRef(0);
  const refreshAllTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAllInFlightRef = useRef(false);
  const refreshAllPendingRef = useRef(false);
  const accountRefreshTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const accountRefreshInFlightRef = useRef<Set<string>>(new Set());
  const accountRefreshPendingRef = useRef<Set<string>>(new Set());

  const refreshAllNow = useCallback(async () => {
    if (accountIds.length === 0) {
      setCountsByAccountId({});
      return;
    }

    const generation = ++fetchGenerationRef.current;
    refreshAllInFlightRef.current = true;

    try {
      const counts = await getOpenConversationCountsByAccountIds(accountIds);
      if (generation !== fetchGenerationRef.current) return;
      setCountsByAccountId(counts);
    } catch {
      if (generation !== fetchGenerationRef.current) return;
    } finally {
      refreshAllInFlightRef.current = false;
      if (refreshAllPendingRef.current) {
        refreshAllPendingRef.current = false;
        void refreshAllNow();
      }
    }
  }, [accountIds]);

  const refresh = useCallback(() => {
    if (refreshAllTimeoutRef.current) {
      clearTimeout(refreshAllTimeoutRef.current);
    }
    refreshAllTimeoutRef.current = setTimeout(() => {
      refreshAllTimeoutRef.current = null;
      if (refreshAllInFlightRef.current) {
        refreshAllPendingRef.current = true;
        return;
      }
      void refreshAllNow();
    }, REFRESH_DEBOUNCE_MS);
  }, [refreshAllNow]);

  const refreshAccountNow = useCallback(async (accountId: string) => {
    if (!accountIds.includes(accountId)) return;

    accountRefreshInFlightRef.current.add(accountId);
    try {
      const count = await getOpenConversationCount(accountId);
      setCountsByAccountId((prev) => ({ ...prev, [accountId]: count }));
    } catch {
      /* keep prior count on error */
    } finally {
      accountRefreshInFlightRef.current.delete(accountId);
      if (accountRefreshPendingRef.current.has(accountId)) {
        accountRefreshPendingRef.current.delete(accountId);
        void refreshAccountNow(accountId);
      }
    }
  }, [accountIds]);

  const scheduleAccountRefresh = useCallback((accountId: string) => {
    if (!accountIds.includes(accountId)) return;

    const existing = accountRefreshTimeoutsRef.current.get(accountId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      accountRefreshTimeoutsRef.current.delete(accountId);
      if (accountRefreshInFlightRef.current.has(accountId)) {
        accountRefreshPendingRef.current.add(accountId);
        return;
      }
      void refreshAccountNow(accountId);
    }, ACCOUNT_REFRESH_DEBOUNCE_MS);

    accountRefreshTimeoutsRef.current.set(accountId, timeout);
  }, [accountIds, refreshAccountNow]);

  const adjustCount = useCallback((accountId: string, delta: number) => {
    if (!accountIds.includes(accountId) || delta === 0) return;
    setCountsByAccountId((prev) => {
      const current = prev[accountId] ?? 0;
      return { ...prev, [accountId]: Math.max(0, current + delta) };
    });
  }, [accountIds]);

  useEffect(() => {
    void refreshAllNow();
  }, [accountIdsKey, refreshAllNow]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDocumentVisible()) return;
      refresh();
    }, FALLBACK_POLL_MS);

    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId || accountIds.length === 0) return;

    const channelName = `open-conversation-counts:${userId}`;
    let channel = supabase.channel(channelName);

    for (const accountId of accountIds) {
      channel = channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'email_threads',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          scheduleAccountRefresh(accountId);
        },
      );
      channel = channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'email_threads',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          scheduleAccountRefresh(accountId);
        },
      );
    }

    channel.subscribe();

    return () => {
      for (const timeout of accountRefreshTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      accountRefreshTimeoutsRef.current.clear();
      void supabase.removeChannel(channel);
    };
  }, [user?.id, accountIdsKey, accountIds, scheduleAccountRefresh]);

  useEffect(() => {
    return () => {
      if (refreshAllTimeoutRef.current) {
        clearTimeout(refreshAllTimeoutRef.current);
      }
      for (const timeout of accountRefreshTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      accountRefreshTimeoutsRef.current.clear();
    };
  }, []);

  const currentCount = account?.id ? countsByAccountId[account.id] ?? 0 : 0;

  const value = useMemo(
    () => ({
      countsByAccountId,
      currentCount,
      refresh,
      adjustCount,
    }),
    [countsByAccountId, currentCount, refresh, adjustCount],
  );

  return (
    <OpenConversationCountsContext.Provider value={value}>
      {children}
    </OpenConversationCountsContext.Provider>
  );
}

export function useOpenConversationCounts(): OpenConversationCountsContextValue {
  const context = useContext(OpenConversationCountsContext);
  if (!context) {
    throw new Error('useOpenConversationCounts must be used within OpenConversationCountsProvider');
  }
  return context;
}

export function useOpenConversationCountsOptional(): OpenConversationCountsContextValue | null {
  return useContext(OpenConversationCountsContext);
}
