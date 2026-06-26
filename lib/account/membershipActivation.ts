import type { AccountMembership } from '@/lib/supabase/services/accounts';

export type AccountSyncSnapshot = {
  memberships: AccountMembership[];
  currentAccountId: string | null;
};

export type MembershipActivationResult =
  | { kind: 'ready'; accountId: string | null; membershipCount: number }
  | { kind: 'timed_out' }
  | { kind: 'error'; message: string };

export type AccountRefetchOptions = {
  userId?: string;
  email?: string;
};

export type AccountRefetchFn = (
  preferredAccountId?: string | null,
  options?: AccountRefetchOptions,
) => Promise<AccountSyncSnapshot | null>;

function resolveReadyMembership(
  memberships: AccountMembership[],
  expectedAccountId?: string | null,
): { accountId: string | null; membershipCount: number } | null {
  if (memberships.length === 0) return null;

  if (expectedAccountId) {
    const match = memberships.find((entry) => entry.account.id === expectedAccountId);
    if (!match) return null;
    return { accountId: match.account.id, membershipCount: memberships.length };
  }

  const owner = memberships.find((entry) => entry.membership.is_owner) ?? memberships[0];
  return {
    accountId: owner?.account.id ?? null,
    membershipCount: memberships.length,
  };
}

export async function pollMembershipVisibility(args: {
  fetchMemberships: () => Promise<AccountMembership[]>;
  expectedAccountId?: string | null;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<MembershipActivationResult> {
  const maxAttempts = args.maxAttempts ?? 10;
  const delayMs = args.delayMs ?? 1500;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const memberships = await args.fetchMemberships();
      const ready = resolveReadyMembership(memberships, args.expectedAccountId);
      if (ready) {
        return { kind: 'ready', ...ready };
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return { kind: 'timed_out' };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'We could not confirm your workspace access yet.',
    };
  }
}

export async function syncMembershipToContext(args: {
  userId: string;
  email?: string | null;
  refetch: AccountRefetchFn;
  expectedAccountId?: string | null;
  fetchMemberships?: () => Promise<AccountMembership[]>;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<MembershipActivationResult> {
  const maxAttempts = args.maxAttempts ?? 30;
  const delayMs = args.delayMs ?? 1500;
  const refetchOptions: AccountRefetchOptions = {
    userId: args.userId,
    email: args.email ?? undefined,
  };

  const fetchMemberships =
    args.fetchMemberships ??
    (async () => {
      const { getAccountMembershipsForUser } = await import('@/lib/supabase/services/accounts');
      return getAccountMembershipsForUser(args.userId);
    });

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const memberships = await fetchMemberships();
      const dbReady = resolveReadyMembership(memberships, args.expectedAccountId);

      if (dbReady) {
        const preferredAccountId = args.expectedAccountId ?? dbReady.accountId;
        const snapshot = await args.refetch(preferredAccountId, refetchOptions);
        const synced = snapshot
          ? resolveReadyMembership(snapshot.memberships, args.expectedAccountId)
          : null;
        if (synced) {
          return {
            kind: 'ready',
            accountId: synced.accountId,
            membershipCount: synced.membershipCount,
          };
        }
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return { kind: 'timed_out' };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'We could not confirm your workspace access yet.',
    };
  }
}
