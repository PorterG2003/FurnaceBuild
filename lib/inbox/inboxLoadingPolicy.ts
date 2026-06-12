import type { InboxRouteAccessStatus } from '@/hooks/useInboxRouteAccess';

export type InboxLoadingPhase =
  | 'ready'
  | 'accountTransition'
  | 'threadListLoading'
  | 'routeResolving'
  | 'messagesLoading';

export interface InboxLoadingPolicyInput {
  accountId: string | null;
  initialThreadsLoadPending: boolean;
  isAccountTransitioning: boolean;
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

export interface InboxLoadingPolicyRaw {
  phase: InboxLoadingPhase;
  /** Immediate skeleton (account transition / route resolving). */
  threadListSkeletonImmediate: boolean;
  /** Delayed skeleton (initial load, slow empty reload). */
  threadListSkeletonDelayed: boolean;
  messagePaneSkeletonImmediate: boolean;
  messageBodySkeletonDelayed: boolean;
  suppressEmptyStates: boolean;
  keepPreviousThreadList: boolean;
}

export function computeInboxLoadingPolicy(input: InboxLoadingPolicyInput): InboxLoadingPolicyRaw {
  const {
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
  } = input;

  const isAccountTransition = isAccountTransitioning || switchingAccount;
  const isRouteResolving =
    routeThreadId != null && selectedThreadId == null && routeAccessStatus === 'loading';

  const keepPreviousThreadList = threadCount > 0 && threadsLoading && !isAccountTransition;

  const emptyListLoading =
    !!accountId && threadsLoading && threadCount === 0 && !keepPreviousThreadList && !refreshing;

  let phase: InboxLoadingPhase = 'ready';
  if (isAccountTransition) {
    phase = 'accountTransition';
  } else if (isRouteResolving) {
    phase = 'routeResolving';
  } else if (emptyListLoading) {
    phase = 'threadListLoading';
  } else if (messagesLoading && selectedThreadId != null) {
    phase = 'messagesLoading';
  }

  const suppressEmptyStates =
    initialThreadsLoadPending ||
    isAccountTransition ||
    isRouteResolving ||
    (threadsLoading && threadCount === 0 && !threadsError);

  return {
    phase,
    threadListSkeletonImmediate:
      initialThreadsLoadPending || isAccountTransition || emptyListLoading,
    threadListSkeletonDelayed: false,
    messagePaneSkeletonImmediate:
      isAccountTransition || isRouteResolving || (initialThreadsLoadPending && routeThreadId != null),
    messageBodySkeletonDelayed: messagesLoading && selectedThreadId != null && !isAccountTransition,
    suppressEmptyStates,
    keepPreviousThreadList,
  };
}
