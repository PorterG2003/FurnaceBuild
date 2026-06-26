import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pollMembershipVisibility,
  syncMembershipToContext,
  type AccountSyncSnapshot,
} from './membershipActivation';
import type { AccountMembership } from '@/lib/supabase/services/accounts';

function membership(accountId: string, isOwner = false): AccountMembership {
  return {
    account: {
      id: accountId,
      name: 'Test Account',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      suppress_bounced_emails: false,
    },
    membership: {
      id: `membership-${accountId}`,
      account_id: accountId,
      user_id: 'user-1',
      is_owner: isOwner,
      role: isOwner ? 'owner' : 'member',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

test('pollMembershipVisibility returns ready when membership appears during polling', async () => {
  let attempts = 0;

  const result = await pollMembershipVisibility({
    delayMs: 0,
    async fetchMemberships() {
      attempts += 1;
      return attempts >= 3 ? [membership('account-1', true)] : [];
    },
  });

  assert.deepEqual(result, {
    kind: 'ready',
    accountId: 'account-1',
    membershipCount: 1,
  });
  assert.equal(attempts, 3);
});

test('pollMembershipVisibility returns timed_out when memberships never appear', async () => {
  const result = await pollMembershipVisibility({
    delayMs: 0,
    maxAttempts: 3,
    async fetchMemberships() {
      return [];
    },
  });

  assert.deepEqual(result, { kind: 'timed_out' });
});

test('pollMembershipVisibility returns an error result when membership lookup fails', async () => {
  const result = await pollMembershipVisibility({
    delayMs: 0,
    async fetchMemberships() {
      throw new Error('Failed to fetch account memberships');
    },
  });

  assert.deepEqual(result, {
    kind: 'error',
    message: 'Failed to fetch account memberships',
  });
});

test('pollMembershipVisibility requires expectedAccountId when provided', async () => {
  const result = await pollMembershipVisibility({
    delayMs: 0,
    maxAttempts: 2,
    expectedAccountId: 'account-target',
    async fetchMemberships() {
      return [membership('account-other')];
    },
  });

  assert.deepEqual(result, { kind: 'timed_out' });
});

test('pollMembershipVisibility returns expected account when filter matches', async () => {
  const result = await pollMembershipVisibility({
    delayMs: 0,
    expectedAccountId: 'account-target',
    async fetchMemberships() {
      return [membership('account-other'), membership('account-target')];
    },
  });

  assert.deepEqual(result, {
    kind: 'ready',
    accountId: 'account-target',
    membershipCount: 2,
  });
});

test('syncMembershipToContext polls, refetches, and selects expected account', async () => {
  let refetchPreferredAccountId: string | null | undefined;
  let refetchOptions: { userId?: string; email?: string } | undefined;

  const result = await syncMembershipToContext({
    userId: 'user-1',
    email: 'invitee@example.com',
    expectedAccountId: 'account-target',
    maxAttempts: 3,
    delayMs: 0,
    fetchMemberships: async () => [membership('account-target', true)],
    refetch: async (preferredAccountId, options) => {
      refetchPreferredAccountId = preferredAccountId;
      refetchOptions = options;
      const snapshot: AccountSyncSnapshot = {
        memberships: [membership('account-target', true)],
        currentAccountId: 'account-target',
      };
      return snapshot;
    },
  });

  assert.deepEqual(result, {
    kind: 'ready',
    accountId: 'account-target',
    membershipCount: 1,
  });
  assert.equal(refetchPreferredAccountId, 'account-target');
  assert.deepEqual(refetchOptions, { userId: 'user-1', email: 'invitee@example.com' });
});

test('syncMembershipToContext retries refetch until snapshot matches', async () => {
  let refetchAttempts = 0;

  const result = await syncMembershipToContext({
    userId: 'user-1',
    expectedAccountId: 'account-target',
    maxAttempts: 5,
    delayMs: 0,
    fetchMemberships: async () => [membership('account-target', true)],
    refetch: async () => {
      refetchAttempts += 1;
      if (refetchAttempts < 3) {
        return null;
      }
      return {
        memberships: [membership('account-target', true)],
        currentAccountId: 'account-target',
      };
    },
  });

  assert.deepEqual(result, {
    kind: 'ready',
    accountId: 'account-target',
    membershipCount: 1,
  });
  assert.equal(refetchAttempts, 3);
});

test('syncMembershipToContext times out when refetch never syncs expected account', async () => {
  const result = await syncMembershipToContext({
    userId: 'user-1',
    expectedAccountId: 'account-target',
    maxAttempts: 3,
    delayMs: 0,
    fetchMemberships: async () => [membership('account-target', true)],
    refetch: async () => ({
      memberships: [membership('account-other')],
      currentAccountId: 'account-other',
    }),
  });

  assert.deepEqual(result, { kind: 'timed_out' });
});
