import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSeedEnv } from '@/scripts/seed/env';

const METER = 'apollo_enrichment';

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function loadEnv(): { url: string; serviceRoleKey: string } {
  loadSeedEnv();
  const url = firstNonEmpty(
    process.env.CAMPAIGN_TEST_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.CAMPAIGN_TEST_SUPABASE_SERVICE_ROLE_KEY,
    process.env.CAMPAIGN_TEST_SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  );
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Credit RPC tests require SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.',
    );
  }
  return { url, serviceRoleKey };
}

interface BalanceRow {
  used: number;
  remaining: number;
  credit_limit: number;
}

class CreditsHarness {
  readonly supabase: SupabaseClient;
  readonly accountId = randomUUID();
  readonly userId = randomUUID();
  private ensured = false;

  constructor() {
    const env = loadEnv();
    this.supabase = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async setup(): Promise<void> {
    if (this.ensured) return;
    const now = new Date().toISOString();
    const { error: userError } = await this.supabase.from('users').upsert(
      {
        id: this.userId,
        external_id: this.userId,
        email: `credits-test-${this.userId.slice(0, 8)}@furnace.test`,
        name: 'Credits Test User',
        created_at: now,
        updated_at: now,
      } as never,
      { onConflict: 'id' },
    );
    assert.equal(userError, null, userError?.message);

    const { error: accountError } = await this.supabase.from('accounts').upsert(
      {
        id: this.accountId,
        name: `Credits Test Account ${this.accountId.slice(0, 8)}`,
        created_at: now,
        updated_at: now,
      } as never,
      { onConflict: 'id' },
    );
    assert.equal(accountError, null, accountError?.message);

    const { error: membershipError } = await this.supabase.from('account_users').insert({
      id: randomUUID(),
      account_id: this.accountId,
      user_id: this.userId,
      is_owner: true,
      role: 'owner',
      created_at: now,
      updated_at: now,
    } as never);
    assert.equal(membershipError, null, membershipError?.message);

    this.ensured = true;
  }

  async cleanup(): Promise<void> {
    await this.supabase.from('credit_ledger').delete().eq('account_id', this.accountId);
    await this.supabase.from('credit_entitlements').delete().eq('account_id', this.accountId);
    await this.supabase.from('account_users').delete().eq('account_id', this.accountId);
    await this.supabase.from('accounts').delete().eq('id', this.accountId);
    await this.supabase.from('users').delete().eq('id', this.userId);
  }

  async balance(): Promise<BalanceRow> {
    const { data, error } = await this.supabase.rpc('get_credit_balance', {
      p_account_id: this.accountId,
      p_meter: METER,
    });
    assert.equal(error, null, error?.message);
    const row = (Array.isArray(data) ? data[0] : data) as BalanceRow;
    return row;
  }

  async consume(amount: number, extra: Record<string, unknown> = {}) {
    return this.supabase.rpc('consume_credit', {
      p_account_id: this.accountId,
      p_meter: METER,
      p_amount: amount,
      p_created_by: this.userId,
      ...extra,
    });
  }
}

test('credit system: balance, consume, audit, refund, override, limit, period, concurrency', async (t) => {
  const harness = new CreditsHarness();
  await harness.setup();

  t.after(async () => {
    await harness.cleanup();
  });

  await t.test('starts at the global default allowance (100)', async () => {
    const b = await harness.balance();
    assert.equal(b.credit_limit, 100);
    assert.equal(b.remaining, 100);
    assert.equal(b.used, 0);
  });

  await t.test('consume decrements remaining and increments used', async () => {
    const { error } = await harness.consume(1, {
      p_reason: 'apollo_person_match',
      p_ref_type: 'global_lead',
      p_ref_id: 'lead-1',
    });
    assert.equal(error, null, error?.message);
    const b = await harness.balance();
    assert.equal(b.remaining, 99);
    assert.equal(b.used, 1);
  });

  await t.test('audit-only (amount 0) rows do not change the balance', async () => {
    const { error } = await harness.consume(0, { p_reason: 'apollo_no_match' });
    assert.equal(error, null, error?.message);
    const b = await harness.balance();
    assert.equal(b.remaining, 99);
    assert.equal(b.used, 1);
  });

  await t.test('grant_credit (refund) increases remaining', async () => {
    const { error } = await harness.supabase.rpc('grant_credit', {
      p_account_id: harness.accountId,
      p_meter: METER,
      p_amount: 1,
      p_reason: 'refund',
    });
    assert.equal(error, null, error?.message);
    const b = await harness.balance();
    assert.equal(b.remaining, 100);
    assert.equal(b.used, 0);
  });

  await t.test('ledger rows in a previous MST month do not count', async () => {
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const { error } = await harness.supabase.from('credit_ledger').insert({
      account_id: harness.accountId,
      meter: METER,
      delta: -50,
      reason: 'previous_period',
      created_at: lastMonth.toISOString(),
    } as never);
    assert.equal(error, null, error?.message);
    const b = await harness.balance();
    // Still 100 — last month's consumption is outside the current period.
    assert.equal(b.remaining, 100);
  });

  await t.test('per-account entitlement override beats the global default', async () => {
    const { error } = await harness.supabase.from('credit_entitlements').insert({
      meter: METER,
      account_id: harness.accountId,
      monthly_grant: 3,
    } as never);
    assert.equal(error, null, error?.message);
    const b = await harness.balance();
    assert.equal(b.credit_limit, 3);
    // Earlier consume (-1) was refunded (+1) and last month's row is excluded,
    // so the net this period is 0 → remaining equals the new limit.
    assert.equal(b.remaining, 3);
  });

  await t.test('consume raises INSUFFICIENT_CREDITS when the balance is too low', async () => {
    // limit 3, remaining 3 → drain all 3, then the next must fail.
    const r1 = await harness.consume(3, { p_reason: 'drain' });
    assert.equal(r1.error, null, r1.error?.message);
    const r2 = await harness.consume(1, { p_reason: 'overflow' });
    assert.notEqual(r2.error, null);
    assert.match(r2.error?.message ?? '', /INSUFFICIENT_CREDITS/);
    const b = await harness.balance();
    assert.equal(b.remaining, 0);
  });

  await t.test('concurrent consumes cannot exceed the limit', async () => {
    // Fresh meter on a second account to isolate concurrency behavior.
    const concurrencyHarness = new CreditsHarness();
    await concurrencyHarness.setup();
    try {
      await concurrencyHarness.supabase.from('credit_entitlements').insert({
        meter: METER,
        account_id: concurrencyHarness.accountId,
        monthly_grant: 5,
      } as never);

      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          concurrencyHarness.consume(1, { p_ref_id: `c-${i}` }),
        ),
      );
      const successes = attempts.filter((a) => a.error == null).length;
      assert.equal(successes, 5);
      const b = await concurrencyHarness.balance();
      assert.equal(b.remaining, 0);
    } finally {
      await concurrencyHarness.cleanup();
    }
  });
});
