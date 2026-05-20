'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Account, AccountUser, BlockListEntry, Invitation, User } from '@/lib/supabase/types';
import type { AccountMembership } from '@/lib/supabase/services/accounts';
import {
  getAccountMembers,
  getAccountMembershipsForUser,
  getAccountInvitations,
  updateUserProfile,
} from '@/lib/supabase/services/accounts';
import { getBlockList } from '@/lib/supabase/services/block-list';

function buildDefaultAccountName(loginId: string | null, currentName?: string | null): string {
  if (currentName && currentName.trim().length > 0) {
    return `${currentName.trim()}'s Account`;
  }
  if (loginId && loginId.trim().length > 0) {
    return `${loginId.trim()}'s Account`;
  }
  return 'New Account';
}

interface AccountContextValue {
  user: User | null;
  account: Account | null;
  memberships: AccountMembership[];
  teamMembers: Array<{ user: User; membership: AccountUser }>;
  invitations: Invitation[];
  blockList: BlockListEntry[];
  loading: boolean;
  accountDataLoading: boolean;
  isAccountPageReady: boolean;
  error: string | null;
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

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { user: authUser } = useAuth();
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<AccountMembership[]>([]);
  const [currentAccountId, setCurrentAccountIdState] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ user: User; membership: AccountUser }>>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [blockList, setBlockList] = useState<BlockListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountDataLoading, setAccountDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedIdRef = useRef<string | null>(null);

  const fetchUserAndMemberships = useCallback(
    async (authUserId: string, email: string, name?: string | null): Promise<AccountMembership[] | null> => {
      setLoading(true);
      setError(null);

      try {
        let user: User | null = null;

        // handle_new_user trigger creates the row; retry once if not yet visible
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUserId)
            .maybeSingle();

          if (existingUser) {
            if (existingUser.email !== email) {
              user = await updateUserProfile(existingUser.id, { email });
            } else {
              user = existingUser;
            }
            break;
          }

          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (!user) {
          throw new Error('User profile not found. The account may still be initializing — please refresh.');
        }

        let nextMemberships = await getAccountMembershipsForUser(user.id);

        if (nextMemberships.length === 0) {
          const accountName = buildDefaultAccountName(email, user.name);
          const { data: newAccountId, error: rpcErr } = await supabase.rpc('bootstrap_account', {
            p_account_name: accountName,
          });
          if (rpcErr || !newAccountId) {
            throw new Error(rpcErr?.message ?? 'Failed to bootstrap account');
          }
          nextMemberships = await getAccountMembershipsForUser(user.id);
        }

        setSupabaseUser(user);
        setMemberships(nextMemberships);

        const primary = nextMemberships.find((m) => m.membership.is_owner) ?? nextMemberships[0];
        setCurrentAccountIdState((prev) => {
          if (!prev) return primary?.account.id ?? null;
          const stillMember = nextMemberships.some((m) => m.account.id === prev);
          return stillMember ? prev : (primary?.account.id ?? null);
        });

        return nextMemberships;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setSupabaseUser(null);
        setMemberships([]);
        setCurrentAccountIdState(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!authUser) {
      setSupabaseUser(null);
      setMemberships([]);
      setCurrentAccountIdState(null);
      setTeamMembers([]);
      setInvitations([]);
      setBlockList([]);
      setLoading(false);
      setAccountDataLoading(false);
      setError(null);
      lastFetchedIdRef.current = null;
      return;
    }

    if (lastFetchedIdRef.current === authUser.id) return;
    lastFetchedIdRef.current = authUser.id;

    const email = authUser.email ?? '';
    const name = authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? null;
    fetchUserAndMemberships(authUser.id, email, name);
  }, [authUser, fetchUserAndMemberships]);

  const fetchAccountData = useCallback(async (accountId: string) => {
    const [members, pendingInvitations, blockListData] = await Promise.all([
      getAccountMembers(accountId),
      getAccountInvitations(accountId),
      getBlockList(accountId),
    ]);
    setTeamMembers(members);
    setInvitations(pendingInvitations);
    setBlockList(blockListData);
  }, []);

  const refetchAccountData = useCallback(async () => {
    if (!currentAccountId) return;
    await fetchAccountData(currentAccountId);
  }, [currentAccountId, fetchAccountData]);

  useEffect(() => {
    if (!currentAccountId || memberships.length === 0) {
      setTeamMembers([]);
      setInvitations([]);
      setBlockList([]);
      setAccountDataLoading(false);
      return;
    }

    let cancelled = false;
    setAccountDataLoading(true);

    void (async () => {
      try {
        await fetchAccountData(currentAccountId);
      } finally {
        if (!cancelled) {
          setAccountDataLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentAccountId, memberships.length, fetchAccountData]);

  const setCurrentAccountId = useCallback((accountId: string) => {
    setCurrentAccountIdState((prev) => {
      const isMember = memberships.some((m) => m.account.id === accountId);
      return isMember ? accountId : prev;
    });
  }, [memberships]);

  const account = useMemo(() => {
    if (!currentAccountId || !memberships.length) return null;
    const entry = memberships.find((m) => m.account.id === currentAccountId);
    return entry?.account ?? null;
  }, [currentAccountId, memberships]);

  const refetch = useCallback(async () => {
    if (!authUser) return;
    const email = authUser.email ?? '';
    const name = authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? null;
    lastFetchedIdRef.current = null;
    const nextMemberships = await fetchUserAndMemberships(authUser.id, email, name);
    const primary = nextMemberships?.find((m) => m.membership.is_owner) ?? nextMemberships?.[0];
    if (primary?.account.id) {
      setAccountDataLoading(true);
      try {
        await fetchAccountData(primary.account.id);
      } finally {
        setAccountDataLoading(false);
      }
    }
  }, [authUser, fetchUserAndMemberships, fetchAccountData]);

  const isAccountPageReady = !loading && !accountDataLoading && !error;

  const value = useMemo<AccountContextValue>(
    () => ({
      user: supabaseUser,
      account,
      memberships,
      teamMembers,
      invitations,
      blockList,
      loading,
      accountDataLoading,
      isAccountPageReady,
      error,
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
      accountDataLoading,
      isAccountPageReady,
      error,
      refetch,
      refetchAccountData,
      setCurrentAccountId,
    ]
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
