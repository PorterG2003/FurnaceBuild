'use client';

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { PlatformAdminAccessStatus } from '@/lib/account/platformAdminAccess';
import {
  clearAccountCache,
  loadAccountCache,
  saveAccountCache,
  type CachedAccountState,
} from '@/lib/account/accountCache';
import type { Account, AccountBilling, AccountUser, BlockListEntry, Invitation, User } from '@/lib/supabase/types';
import type { AccountMembership } from '@/lib/supabase/services/accounts';
import {
  getAccountMembers,
  getAccountMembershipsForUser,
  getAccountInvitations,
  updateUserProfile,
} from '@/lib/supabase/services/accounts';
import { getBlockList } from '@/lib/supabase/services/block-list';
import { getAccountBilling } from '@/lib/supabase/services/platform';
import { getUserHasPlatformAdminAccess } from '@/lib/supabase/services/user-access-flags';

interface AccountContextValue {
  user: User | null;
  account: Account | null;
  memberships: AccountMembership[];
  teamMembers: Array<{ user: User; membership: AccountUser }>;
  invitations: Invitation[];
  blockList: BlockListEntry[];
  loading: boolean;
  initialized: boolean;
  refetching: boolean;
  error: string | null;
  platformAdminAccess: PlatformAdminAccessStatus;
  billing: AccountBilling | null;
  isFrontendBlocked: boolean;
  refetch: () => Promise<void>;
  refetchAccountData: () => Promise<void>;
  setCurrentAccountId: (accountId: string) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return ctx;
}

function pickAccountId(memberships: AccountMembership[], preferredId: string | null): string | null {
  if (memberships.length === 0) return null;
  if (preferredId && memberships.some((m) => m.account.id === preferredId)) {
    return preferredId;
  }
  const primary = memberships.find((m) => m.membership.is_owner) ?? memberships[0];
  return primary?.account.id ?? null;
}

async function fetchOrUpsertUser(authUserId: string, email: string): Promise<User> {
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUserId)
    .maybeSingle();

  if (existingUser) {
    if (existingUser.email !== email) {
      return updateUserProfile(existingUser.id, { email });
    }
    return existingUser;
  }

  // handle_new_user trigger creates the row; retry once if not yet visible
  await new Promise((r) => setTimeout(r, 500));
  const { data: retryUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUserId)
    .maybeSingle();

  if (!retryUser) {
    throw new Error('User profile not found. The account may still be initializing — please refresh.');
  }

  if (retryUser.email !== email) {
    return updateUserProfile(retryUser.id, { email });
  }

  return retryUser;
}

async function fetchAccountScopedData(accountId: string, authUserId: string) {
  const [teamMembers, invitations, blockList, billing, isAdmin] = await Promise.all([
    getAccountMembers(accountId),
    getAccountInvitations(accountId),
    getBlockList(accountId),
    getAccountBilling(accountId),
    getUserHasPlatformAdminAccess(authUserId),
  ]);

  return {
    teamMembers,
    invitations,
    blockList,
    billing,
    platformAdminAccess: (isAdmin ? 'allowed' : 'denied') as Exclude<PlatformAdminAccessStatus, 'loading'>,
  };
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { user: authUser } = useAuth();
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<AccountMembership[]>([]);
  const [currentAccountId, setCurrentAccountIdState] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ user: User; membership: AccountUser }>>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [blockList, setBlockList] = useState<BlockListEntry[]>([]);
  const [billing, setBilling] = useState<AccountBilling | null>(null);
  const [platformAdminAccess, setPlatformAdminAccess] = useState<PlatformAdminAccessStatus>('denied');
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preferredAccountIdRef = useRef<string | null>(null);
  const accountDataLoadedForRef = useRef<string | null>(null);
  const bootstrapRunIdRef = useRef(0);
  const bootstrappedUserIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!authUser) {
      bootstrappedUserIdRef.current = null;
      return;
    }
    if (bootstrappedUserIdRef.current === authUser.id) return;
    setInitialized(false);
    setLoading(true);
    setPlatformAdminAccess('loading');
  }, [authUser?.id]);

  const applyCachedState = useCallback((cached: CachedAccountState) => {
    setSupabaseUser(cached.user);
    setMemberships(cached.memberships);
    setCurrentAccountIdState(cached.currentAccountId);
    preferredAccountIdRef.current = cached.currentAccountId;
    setTeamMembers(cached.teamMembers);
    setInvitations(cached.invitations);
    setBlockList(cached.blockList);
    setBilling(cached.billing);
    setPlatformAdminAccess(cached.platformAdminAccess);
    accountDataLoadedForRef.current = cached.currentAccountId;
  }, []);

  const resetState = useCallback(() => {
    setSupabaseUser(null);
    setMemberships([]);
    setCurrentAccountIdState(null);
    preferredAccountIdRef.current = null;
    setTeamMembers([]);
    setInvitations([]);
    setBlockList([]);
    setBilling(null);
    setPlatformAdminAccess('denied');
    setLoading(false);
    setInitialized(false);
    setRefetching(false);
    setError(null);
    accountDataLoadedForRef.current = null;
  }, []);

  const bootstrap = useCallback(
    async (authUserId: string, email: string, preferredAccountId: string | null) => {
      const user = await fetchOrUpsertUser(authUserId, email);
      const nextMemberships = await getAccountMembershipsForUser(user.id);
      const accountId = pickAccountId(nextMemberships, preferredAccountId);

      let accountScoped = {
        teamMembers: [] as Array<{ user: User; membership: AccountUser }>,
        invitations: [] as Invitation[],
        blockList: [] as BlockListEntry[],
        billing: null as AccountBilling | null,
        platformAdminAccess: 'denied' as Exclude<PlatformAdminAccessStatus, 'loading'>,
      };

      if (accountId) {
        accountScoped = await fetchAccountScopedData(accountId, authUserId);
      } else {
        const isAdmin = await getUserHasPlatformAdminAccess(authUserId);
        accountScoped.platformAdminAccess = isAdmin ? 'allowed' : 'denied';
      }

      return {
        user,
        memberships: nextMemberships,
        currentAccountId: accountId,
        ...accountScoped,
      };
    },
    []
  );

  useEffect(() => {
    if (!authUser) {
      resetState();
      void clearAccountCache();
      return;
    }

    const authUserId = authUser.id;
    const email = authUser.email ?? '';
    const runId = ++bootstrapRunIdRef.current;
    let cancelled = false;

    void (async () => {
      const cached = await loadAccountCache(authUserId);
      if (cancelled || bootstrapRunIdRef.current !== runId) return;

      const hadCache = !!cached;
      if (cached) {
        applyCachedState(cached);
        setLoading(false);
      } else {
        setLoading(true);
        setPlatformAdminAccess('loading');
      }

      setError(null);

      try {
        const preferredAccountId = preferredAccountIdRef.current ?? cached?.currentAccountId ?? null;
        const result = await bootstrap(authUserId, email, preferredAccountId);
        if (cancelled || bootstrapRunIdRef.current !== runId) return;

        setSupabaseUser(result.user);
        setMemberships(result.memberships);
        setCurrentAccountIdState(result.currentAccountId);
        preferredAccountIdRef.current = result.currentAccountId;
        setTeamMembers(result.teamMembers);
        setInvitations(result.invitations);
        setBlockList(result.blockList);
        setBilling(result.billing);
        setPlatformAdminAccess(result.platformAdminAccess);
        accountDataLoadedForRef.current = result.currentAccountId;

        await saveAccountCache(authUserId, {
          user: result.user,
          memberships: result.memberships,
          currentAccountId: result.currentAccountId,
          teamMembers: result.teamMembers,
          invitations: result.invitations,
          blockList: result.blockList,
          platformAdminAccess: result.platformAdminAccess,
          billing: result.billing,
        });
      } catch (err) {
        if (cancelled || bootstrapRunIdRef.current !== runId) return;
        if (!hadCache) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setError(message);
          setSupabaseUser(null);
          setMemberships([]);
          setCurrentAccountIdState(null);
          preferredAccountIdRef.current = null;
          setTeamMembers([]);
          setInvitations([]);
          setBlockList([]);
          setBilling(null);
          setPlatformAdminAccess('denied');
        }
      } finally {
        if (!cancelled && bootstrapRunIdRef.current === runId) {
          setLoading(false);
          setInitialized(true);
          bootstrappedUserIdRef.current = authUserId;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, applyCachedState, bootstrap, resetState]);

  useEffect(() => {
    if (!authUser || !currentAccountId || memberships.length === 0) {
      if (!currentAccountId || memberships.length === 0) {
        setTeamMembers([]);
        setInvitations([]);
        setBlockList([]);
        setBilling(null);
      }
      return;
    }

    if (accountDataLoadedForRef.current === currentAccountId) {
      accountDataLoadedForRef.current = null;
      return;
    }

    let cancelled = false;
    setRefetching(true);

    void (async () => {
      try {
        const scoped = await fetchAccountScopedData(currentAccountId, authUser.id);
        if (cancelled) return;
        setTeamMembers(scoped.teamMembers);
        setInvitations(scoped.invitations);
        setBlockList(scoped.blockList);
        setBilling(scoped.billing);
        setPlatformAdminAccess(scoped.platformAdminAccess);
      } finally {
        if (!cancelled) {
          setRefetching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, currentAccountId, memberships.length]);

  const setCurrentAccountId = useCallback(
    (accountId: string) => {
      setCurrentAccountIdState((prev) => {
        const isMember = memberships.some((m) => m.account.id === accountId);
        if (!isMember) return prev;
        preferredAccountIdRef.current = accountId;
        return accountId;
      });
    },
    [memberships]
  );

  const account = useMemo(() => {
    if (!currentAccountId || !memberships.length) return null;
    const entry = memberships.find((m) => m.account.id === currentAccountId);
    return entry?.account ?? null;
  }, [currentAccountId, memberships]);

  const refetchAccountData = useCallback(async () => {
    if (!authUser || !currentAccountId) return;
    setRefetching(true);
    try {
      const scoped = await fetchAccountScopedData(currentAccountId, authUser.id);
      setTeamMembers(scoped.teamMembers);
      setInvitations(scoped.invitations);
      setBlockList(scoped.blockList);
      setBilling(scoped.billing);
      setPlatformAdminAccess(scoped.platformAdminAccess);

      if (supabaseUser) {
        await saveAccountCache(authUser.id, {
          user: supabaseUser,
          memberships,
          currentAccountId,
          teamMembers: scoped.teamMembers,
          invitations: scoped.invitations,
          blockList: scoped.blockList,
          platformAdminAccess: scoped.platformAdminAccess,
          billing: scoped.billing,
        });
      }
    } finally {
      setRefetching(false);
    }
  }, [authUser, currentAccountId, memberships, supabaseUser]);

  const refetch = useCallback(async () => {
    if (!authUser) return;
    const email = authUser.email ?? '';
    setRefetching(true);
    setError(null);

    try {
      const preferredAccountId = preferredAccountIdRef.current ?? currentAccountId;
      const result = await bootstrap(authUser.id, email, preferredAccountId);

      setSupabaseUser(result.user);
      setMemberships(result.memberships);
      setCurrentAccountIdState(result.currentAccountId);
      preferredAccountIdRef.current = result.currentAccountId;
      setTeamMembers(result.teamMembers);
      setInvitations(result.invitations);
      setBlockList(result.blockList);
      setBilling(result.billing);
      setPlatformAdminAccess(result.platformAdminAccess);
      accountDataLoadedForRef.current = result.currentAccountId;

      await saveAccountCache(authUser.id, {
        user: result.user,
        memberships: result.memberships,
        currentAccountId: result.currentAccountId,
        teamMembers: result.teamMembers,
        invitations: result.invitations,
        blockList: result.blockList,
        platformAdminAccess: result.platformAdminAccess,
        billing: result.billing,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setRefetching(false);
    }
  }, [authUser, bootstrap, currentAccountId]);

  const isFrontendBlocked = billing?.billing_status === 'payment_required';

  const value = useMemo<AccountContextValue>(
    () => ({
      user: supabaseUser,
      account,
      memberships,
      teamMembers,
      invitations,
      blockList,
      loading,
      initialized,
      refetching,
      error,
      platformAdminAccess,
      billing,
      isFrontendBlocked,
      refetch,
      refetchAccountData,
      setCurrentAccountId,
    }),
    [
      supabaseUser,
      account,
      memberships,
      teamMembers,
      invitations,
      blockList,
      loading,
      initialized,
      refetching,
      error,
      platformAdminAccess,
      billing,
      isFrontendBlocked,
      refetch,
      refetchAccountData,
      setCurrentAccountId,
    ]
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
