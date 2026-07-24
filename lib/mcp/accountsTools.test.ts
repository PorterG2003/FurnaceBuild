import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountForSession, listAccountsForSession } from './accountsTools.js';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_OTHER = '33333333-3333-4333-8333-333333333333';

type MembershipRow = {
  user_id: string;
  account_id: string;
  role: string;
  is_owner: boolean;
  accounts: { id: string; name: string } | null;
};

type BillingRow = {
  account_id: string;
  billing_status: string | null;
  proposal_snapshot_json?: unknown;
};

/**
 * Minimal chainable supabase stub that filters by applied eq/in clauses.
 */
function createMockSupabase(options: {
  memberships: MembershipRow[];
  billing?: BillingRow[];
  counts?: { members?: number; campaigns?: number; mailboxes?: number };
}): SupabaseClient {
  const billing = options.billing ?? [];
  const counts = options.counts ?? { members: 2, campaigns: 3, mailboxes: 4 };

  function makeChain(table: string) {
    const state: {
      filters: Record<string, unknown>;
      inFilter: { col: string; vals: unknown[] } | null;
      countHead: boolean;
    } = {
      filters: {},
      inFilter: null,
      countHead: false,
    };

    const chain: Record<string, unknown> = {};
    const self = () => chain;

    chain.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      state.countHead = Boolean(opts?.count === 'exact' && opts?.head);
      return self();
    };
    chain.eq = (col: string, val: unknown) => {
      state.filters[col] = val;
      return self();
    };
    chain.in = (col: string, vals: unknown[]) => {
      state.inFilter = { col, vals };
      return self();
    };

    const resolveRows = () => {
      if (table === 'account_users' && !state.countHead) {
        return options.memberships.filter((row) => {
          for (const [col, val] of Object.entries(state.filters)) {
            if ((row as Record<string, unknown>)[col] !== val) return false;
          }
          if (state.inFilter) {
            const v = (row as Record<string, unknown>)[state.inFilter.col];
            if (!state.inFilter.vals.includes(v)) return false;
          }
          return true;
        });
      }
      if (table === 'account_billing') {
        return billing.filter((row) => {
          for (const [col, val] of Object.entries(state.filters)) {
            if ((row as Record<string, unknown>)[col] !== val) return false;
          }
          if (state.inFilter) {
            const v = (row as Record<string, unknown>)[state.inFilter.col];
            if (!state.inFilter.vals.includes(v)) return false;
          }
          return true;
        });
      }
      return [];
    };

    chain.maybeSingle = async () => {
      const rows = resolveRows();
      return { data: rows[0] ?? null, error: null };
    };

    // Thenable for `await supabase.from(...).select().eq()` / count queries
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      try {
        if (state.countHead) {
          let count = 0;
          if (table === 'account_users') count = counts.members ?? 0;
          else if (table === 'campaigns') count = counts.campaigns ?? 0;
          else if (table === 'mailboxes') count = counts.mailboxes ?? 0;
          return Promise.resolve({ data: null, error: null, count }).then(resolve, reject);
        }
        return Promise.resolve({ data: resolveRows(), error: null }).then(resolve, reject);
      } catch (err) {
        return Promise.reject(err).then(resolve, reject);
      }
    };

    return chain;
  }

  return {
    from(table: string) {
      return makeChain(table);
    },
  } as unknown as SupabaseClient;
}

test('listAccountsForSession filters by userId AND grant (adversarial grant excluded)', async () => {
  const supabase = createMockSupabase({
    memberships: [
      {
        user_id: 'user-a',
        account_id: ACCOUNT_A,
        role: 'admin',
        is_owner: true,
        accounts: { id: ACCOUNT_A, name: 'Alpha' },
      },
      {
        user_id: 'user-b',
        account_id: ACCOUNT_OTHER,
        role: 'owner',
        is_owner: true,
        accounts: { id: ACCOUNT_OTHER, name: 'Other workspace' },
      },
    ],
    billing: [{ account_id: ACCOUNT_A, billing_status: 'active' }],
  });

  // Grant includes another user's account (adversarial / stale grant).
  const items = await listAccountsForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_OTHER],
    supabase,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, ACCOUNT_A);
  assert.equal(items[0]?.name, 'Alpha');
  assert.ok(!items.some((i) => i.id === ACCOUNT_OTHER));
});

test('is_default is true only when exactly one account is granted', async () => {
  const memberships: MembershipRow[] = [
    {
      user_id: 'user-a',
      account_id: ACCOUNT_A,
      role: 'member',
      is_owner: false,
      accounts: { id: ACCOUNT_A, name: 'A' },
    },
    {
      user_id: 'user-a',
      account_id: ACCOUNT_B,
      role: 'member',
      is_owner: false,
      accounts: { id: ACCOUNT_B, name: 'B' },
    },
  ];

  const single = await listAccountsForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A],
    supabase: createMockSupabase({ memberships }),
  });
  assert.equal(single.length, 1);
  assert.equal(single[0]?.is_default, true);

  const multi = await listAccountsForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
    supabase: createMockSupabase({ memberships }),
  });
  assert.equal(multi.length, 2);
  assert.ok(multi.every((i) => i.is_default === false));
});

test('getAccountForSession rejects ungranted and non-member accounts', async () => {
  const ungranted = await getAccountForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A],
    accountId: ACCOUNT_OTHER,
    supabase: createMockSupabase({ memberships: [] }),
  });
  assert.equal(ungranted.ok, false);
  if (ungranted.ok) throw new Error('expected failure');
  assert.match(ungranted.message, /not in this session's grant/i);

  const nonMember = await getAccountForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A],
    accountId: ACCOUNT_A,
    supabase: createMockSupabase({ memberships: [] }),
  });
  assert.equal(nonMember.ok, false);
  if (nonMember.ok) throw new Error('expected failure');
  assert.match(nonMember.message, /no longer a member/i);
});

test('getAccountForSession returns detail for granted member', async () => {
  const supabase = createMockSupabase({
    memberships: [
      {
        user_id: 'user-a',
        account_id: ACCOUNT_A,
        role: 'admin',
        is_owner: true,
        accounts: { id: ACCOUNT_A, name: 'Alpha' },
      },
    ],
    billing: [
      {
        account_id: ACCOUNT_A,
        billing_status: 'active',
        proposal_snapshot_json: { plan_tier: 'pro' },
      },
    ],
    counts: { members: 5, campaigns: 7, mailboxes: 2 },
  });

  const result = await getAccountForSession({
    userId: 'user-a',
    allowedAccountIds: [ACCOUNT_A],
    accountId: ACCOUNT_A,
    supabase,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected success');
  assert.equal(result.account.id, ACCOUNT_A);
  assert.equal(result.account.name, 'Alpha');
  assert.equal(result.account.is_default, true);
  assert.equal(result.account.plan_tier, 'pro');
  assert.equal(result.account.member_count, 5);
  assert.equal(result.account.campaign_count, 7);
  assert.equal(result.account.mailbox_count, 2);
});
