import { useEffect, useMemo, useRef, useState } from 'react';
import { useSmoothLoading } from '@/components/ui/feedback';
import {
  computeInboxLoadingPolicy,
  type InboxLoadingPhase,
  type InboxLoadingPolicyInput,
} from '@/lib/inbox/inboxLoadingPolicy';
import type { InboxRouteAccessStatus } from '@/hooks/useInboxRouteAccess';

export interface UseInboxLoadingPolicyOptions {
  accountId: string | null;
  initialThreadsLoadPending: boolean;
  switchingAccount: boolean;
  routeThreadId: string | null;
  selectedThreadId: string | null;
  routeAccessStatus: InboxRouteAccessStatus;
  threadsLoading: boolean;
  threadCount: number;
  threadsError: string | null;
  messagesLoading: boolean;
  hasActiveFilters: boolean;
  refreshing: boolean;
}

export interface InboxLoadingPolicy {
  phase: InboxLoadingPhase;
  showThreadListSkeleton: boolean;
  showMessagePaneSkeleton: boolean;
  showMessageBodySkeleton: boolean;
  suppressEmptyStates: boolean;
  keepPreviousThreadList: boolean;
}

export function useInboxLoadingPolicy(options: UseInboxLoadingPolicyOptions): InboxLoadingPolicy {
  const {
    accountId,
    initialThreadsLoadPending,
    switchingAccount,
    routeThreadId,
    selectedThreadId,
    routeAccessStatus,
    threadsLoading,
    threadCount,
    threadsError,
    messagesLoading,
    hasActiveFilters,
    refreshing,
  } = options;

  const prevAccountIdRef = useRef<string | null>(accountId);
  const [isAccountTransitioning, setIsAccountTransitioning] = useState(false);

  useEffect(() => {
    const prev = prevAccountIdRef.current;
    prevAccountIdRef.current = accountId;
    if (prev != null && accountId != null && prev !== accountId) {
      setIsAccountTransitioning(true);
    }
    if (!accountId) {
      setIsAccountTransitioning(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!isAccountTransitioning) return;
    if (!threadsLoading) {
      setIsAccountTransitioning(false);
    }
  }, [isAccountTransitioning, threadsLoading]);

  const raw = useMemo(
    () =>
      computeInboxLoadingPolicy({
        accountId,
        initialThreadsLoadPending,
        isAccountTransitioning,
        switchingAccount,
        routeThreadId,
        selectedThreadId,
        routeAccessStatus,
        threadsLoading,
        threadCount,
        threadsError,
        messagesLoading,
        hasActiveFilters,
        refreshing,
      } satisfies InboxLoadingPolicyInput),
    [
      accountId,
      initialThreadsLoadPending,
      isAccountTransitioning,
      switchingAccount,
      routeThreadId,
      selectedThreadId,
      routeAccessStatus,
      threadsLoading,
      threadCount,
      threadsError,
      messagesLoading,
      hasActiveFilters,
      refreshing,
    ],
  );

  const showThreadListSkeletonDelayed = useSmoothLoading(raw.threadListSkeletonDelayed);
  const showMessageBodySkeleton = useSmoothLoading(raw.messageBodySkeletonDelayed);

  return {
    phase: raw.phase,
    showThreadListSkeleton: raw.threadListSkeletonImmediate || showThreadListSkeletonDelayed,
    showMessagePaneSkeleton: raw.messagePaneSkeletonImmediate,
    showMessageBodySkeleton,
    suppressEmptyStates: raw.suppressEmptyStates,
    keepPreviousThreadList: raw.keepPreviousThreadList,
  };
}
