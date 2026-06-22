import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { EmailThread } from '@/lib/supabase/types';
import { getThreadById } from '@/lib/supabase/services';
import {
  buildInboxListHref,
  canUseInternalInboxRouteAccess,
  resolveInboxRouteAccess,
  shouldAllowInboxAccountSwitch,
} from '@/lib/inbox/inboxRoutes';

export type InboxRouteAccessStatus = 'loading' | 'list_only' | 'ready' | 'denied';

export interface UseInboxRouteAccessOptions {
  routeThreadId: string | null;
  currentAccountId: string | null;
  membershipAccountIds: string[];
  accountInitialized: boolean;
  accountLoading: boolean;
  setCurrentAccountId: (accountId: string) => void;
  router: { replace: (href: string) => void };
  onDenied?: (reason: 'not_member' | 'thread_not_found') => void;
  internalNavigationRef: MutableRefObject<boolean>;
  loadedThreadIdsRef: MutableRefObject<string[]>;
  loadedForAccountIdRef: MutableRefObject<string | null>;
}

export interface UseInboxRouteAccessResult {
  status: InboxRouteAccessStatus;
  shouldClearFiltersForDeepLink: boolean;
  switchingAccount: boolean;
  consumeDeepLinkFilterClear: () => void;
  /** Thread row from route validation; avoids a duplicate getThreadById in useInboxData. */
  validatedThread: EmailThread | null;
}

export function useInboxRouteAccess({
  routeThreadId,
  currentAccountId,
  membershipAccountIds,
  accountInitialized,
  accountLoading,
  setCurrentAccountId,
  router,
  onDenied,
  internalNavigationRef,
  loadedThreadIdsRef,
  loadedForAccountIdRef,
}: UseInboxRouteAccessOptions): UseInboxRouteAccessResult {
  const [status, setStatus] = useState<InboxRouteAccessStatus>('loading');
  const [shouldClearFiltersForDeepLink, setShouldClearFiltersForDeepLink] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [validatedThread, setValidatedThread] = useState<EmailThread | null>(null);
  const deniedHandledRef = useRef<string | null>(null);
  const prevRouteThreadIdRef = useRef<string | null>(null);
  const validatedRouteThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accountInitialized || accountLoading) {
      setStatus('loading');
      setSwitchingAccount(false);
      return;
    }

    if (!routeThreadId) {
      setStatus('list_only');
      setShouldClearFiltersForDeepLink(false);
      setSwitchingAccount(false);
      setValidatedThread(null);
      validatedRouteThreadIdRef.current = null;
      deniedHandledRef.current = null;
      prevRouteThreadIdRef.current = null;
      return;
    }

    const routeThreadChanged = prevRouteThreadIdRef.current !== routeThreadId;
    prevRouteThreadIdRef.current = routeThreadId;

    if (routeThreadChanged) {
      setValidatedThread(null);
      validatedRouteThreadIdRef.current = null;
    }

    const allowAccountSwitch = shouldAllowInboxAccountSwitch({ routeThreadChanged });

    const trustLoadedThreadList = canUseInternalInboxRouteAccess({
      routeThreadId,
      loadedThreadIds: loadedThreadIdsRef.current,
      loadedForAccountId: loadedForAccountIdRef.current,
      currentAccountId,
    });

    if (trustLoadedThreadList) {
      internalNavigationRef.current = false;
      setStatus('ready');
      setShouldClearFiltersForDeepLink(false);
      setSwitchingAccount(false);
      return;
    }

    if (!routeThreadChanged && validatedRouteThreadIdRef.current === routeThreadId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (routeThreadChanged || validatedRouteThreadIdRef.current !== routeThreadId) {
        setStatus('loading');
      }

      const row = await getThreadById(routeThreadId).catch(() => null);
      if (cancelled) return;

      if (row) {
        setValidatedThread(row);
        validatedRouteThreadIdRef.current = routeThreadId;
      } else {
        setValidatedThread(null);
        validatedRouteThreadIdRef.current = null;
      }

      const threadAccountId = row?.account_id ?? null;

      if (
        threadAccountId &&
        currentAccountId &&
        threadAccountId !== currentAccountId &&
        !allowAccountSwitch
      ) {
        router.replace(buildInboxListHref());
        setStatus('list_only');
        setShouldClearFiltersForDeepLink(false);
        setSwitchingAccount(false);
        return;
      }

      const access = resolveInboxRouteAccess({
        routeThreadId,
        currentAccountId,
        membershipAccountIds,
        threadAccountId,
        threadExists: row != null,
      });

      if (access.status === 'denied') {
        const reason = access.reason ?? 'thread_not_found';
        const denyKey = `${routeThreadId}:${reason}`;
        if (deniedHandledRef.current !== denyKey) {
          deniedHandledRef.current = denyKey;
          onDenied?.(reason);
          router.replace(buildInboxListHref());
        }
        setStatus('denied');
        setShouldClearFiltersForDeepLink(false);
        setSwitchingAccount(false);
        return;
      }

      if (access.targetAccountId && access.targetAccountId !== currentAccountId) {
        if (!allowAccountSwitch) {
          router.replace(buildInboxListHref());
          setStatus('list_only');
          setShouldClearFiltersForDeepLink(false);
          setSwitchingAccount(false);
          return;
        }
        setSwitchingAccount(true);
        setCurrentAccountId(access.targetAccountId);
        setStatus('loading');
        return;
      }

      if (access.status === 'ready') {
        const needsFilterClear = !loadedThreadIdsRef.current.includes(routeThreadId);
        setShouldClearFiltersForDeepLink(needsFilterClear);
        setStatus('ready');
        setSwitchingAccount(false);
        return;
      }

      setStatus('list_only');
      setShouldClearFiltersForDeepLink(false);
      setSwitchingAccount(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    routeThreadId,
    currentAccountId,
    membershipAccountIds,
    accountInitialized,
    accountLoading,
    setCurrentAccountId,
    router,
    onDenied,
    internalNavigationRef,
    loadedThreadIdsRef,
    loadedForAccountIdRef,
  ]);

  const consumeDeepLinkFilterClear = () => {
    setShouldClearFiltersForDeepLink(false);
  };

  return {
    status,
    shouldClearFiltersForDeepLink,
    switchingAccount,
    consumeDeepLinkFilterClear,
    validatedThread,
  };
}
