'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import type { Account, User } from '@/lib/supabase/types';
import type { AccountMembership } from '@/lib/supabase/services/users';
import {
  addUserToAccount,
  createAccount,
  createUserProfile,
  getAccountMembershipsForUser,
  getUserByExternalId,
  updateUserProfile,
} from '@/lib/supabase/services/users';

function buildDefaultAccountName(loginId: string | null, username: string | null, currentName?: string | null): string {
  if (currentName && currentName.trim().length > 0) {
    return `${currentName.trim()}'s Account`;
  }
  if (username && username.trim().length > 0) {
    return `${username.trim()}'s Account`;
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
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
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
  const { user: cognitoUser, authStatus } = useAuthenticator();
  const externalId = cognitoUser?.userId ?? null;
  const loginId = cognitoUser?.signInDetails?.loginId ?? null;
  const username = cognitoUser?.username ?? null;
  const cognitoEmail =
    (cognitoUser as any)?.attributes?.email ??
    (cognitoUser as any)?.attributes?.preferred_username ??
    loginId ??
    null;

  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<AccountMembership[]>([]);
  const [currentAccountId, setCurrentAccountIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserAndMemberships = useCallback(async () => {
    if (!externalId || !cognitoEmail) {
      setSupabaseUser(null);
      setMemberships([]);
      setCurrentAccountIdState(null);
      setLoading(false);
      setError(!externalId ? 'Unable to determine the signed-in user.' : 'Unable to determine your email from Cognito.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let existingUser = await getUserByExternalId(externalId);

      if (!existingUser) {
        existingUser = await createUserProfile({
          external_id: externalId,
          email: cognitoEmail,
          name: username ?? undefined,
        });
      } else if (existingUser.email !== cognitoEmail) {
        existingUser = await updateUserProfile(existingUser.id, { email: cognitoEmail });
      }

      let nextMemberships = await getAccountMembershipsForUser(existingUser.id);

      if (nextMemberships.length === 0) {
        const account = await createAccount({
          name: buildDefaultAccountName(loginId, username, existingUser.name),
        });
        const membershipRecord = await addUserToAccount(account.id, existingUser.id, true);
        nextMemberships = [
          {
            membership: membershipRecord,
            account,
          },
        ];
      }

      setSupabaseUser(existingUser);
      setMemberships(nextMemberships);

      const primary = nextMemberships.find((m) => m.membership.is_owner) ?? nextMemberships[0];
      setCurrentAccountIdState((prev) => {
        if (!prev) return primary?.account.id ?? null;
        const stillMember = nextMemberships.some((m) => m.account.id === prev);
        return stillMember ? prev : (primary?.account.id ?? null);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setSupabaseUser(null);
      setMemberships([]);
      setCurrentAccountIdState(null);
    } finally {
      setLoading(false);
    }
  }, [externalId, cognitoEmail, loginId, username]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !cognitoUser) {
      setSupabaseUser(null);
      setMemberships([]);
      setCurrentAccountIdState(null);
      setLoading(false);
      setError(null);
      return;
    }
    fetchUserAndMemberships();
  }, [authStatus, cognitoUser, fetchUserAndMemberships]);

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

  const value = useMemo<AccountContextValue>(
    () => ({
      user: supabaseUser,
      account,
      memberships,
      loading,
      error,
      refetch: fetchUserAndMemberships,
      setCurrentAccountId,
    }),
    [supabaseUser, account, memberships, loading, error, fetchUserAndMemberships, setCurrentAccountId]
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
