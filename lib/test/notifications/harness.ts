import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSeedEnv, parseSupabaseProjectRef } from '../../../scripts/seed/env';

type DbClient = SupabaseClient;

const PROD_NOTIFICATIONS_TEST_PROJECT_REFS = new Set(['hibwbebpcwbstqbjeviq']);

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export interface NotificationsHarnessEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function loadNotificationsHarnessEnv(): NotificationsHarnessEnv {
  loadSeedEnv();

  const supabaseUrl = firstNonEmpty(
    process.env.NOTIFICATIONS_TEST_SUPABASE_URL,
    process.env.DEV_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.NOTIFICATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY
  );

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Notifications test harness requires NOTIFICATIONS_TEST_SUPABASE_URL (preferred) or DEV_SUPABASE_URL / SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL, plus NOTIFICATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  const projectRef = parseSupabaseProjectRef(supabaseUrl);
  const expectedProjectRef = firstNonEmpty(
    process.env.NOTIFICATIONS_TEST_PROJECT_REF,
    process.env.SEED_PROJECT_REF
  );
  if (expectedProjectRef && projectRef && projectRef.toLowerCase() !== expectedProjectRef.toLowerCase()) {
    throw new Error(
      `Notifications test harness project ref mismatch: expected ${expectedProjectRef}, got ${projectRef}.`
    );
  }

  if (
    projectRef &&
    PROD_NOTIFICATIONS_TEST_PROJECT_REFS.has(projectRef) &&
    process.env.NOTIFICATIONS_TEST_ALLOW_PROD !== '1'
  ) {
    throw new Error(
      `Notifications test harness resolved to protected project ${projectRef}. Set NOTIFICATIONS_TEST_SUPABASE_URL to a non-prod project or export NOTIFICATIONS_TEST_ALLOW_PROD=1 to override intentionally.`
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

export function createNotificationsHarnessClient(env = loadNotificationsHarnessEnv()): DbClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as DbClient;
}

export function createNotificationsTestNamespace(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export class NotificationsDbHarness {
  readonly namespace: string;
  readonly env: NotificationsHarnessEnv;
  readonly supabase: DbClient;
  private readonly cleanupIds = {
    preferenceIds: [] as string[],
    pushSubscriptionIds: [] as string[],
    accountUserIds: [] as string[],
    accountIds: [] as string[],
    userIds: [] as string[],
  };

  constructor(params: { namespace: string; env?: NotificationsHarnessEnv }) {
    this.namespace = params.namespace;
    this.env = params.env ?? loadNotificationsHarnessEnv();
    this.supabase = createNotificationsHarnessClient(this.env);
  }

  async seedMultiAccountUser(): Promise<{
    userId: string;
    accountAId: string;
    accountBId: string;
    pushSubscriptionIds: string[];
  }> {
    const timestamp = new Date().toISOString();
    const userId = randomUUID();
    const accountAId = randomUUID();
    const accountBId = randomUUID();
    const accountUserAId = randomUUID();
    const accountUserBId = randomUUID();
    const prefAId = randomUUID();
    const sub1Id = randomUUID();
    const sub2Id = randomUUID();

    const userInsert = await this.supabase.from('users').insert({
      id: userId,
      external_id: `notif-test-${this.namespace}-${userId.slice(0, 8)}`,
      email: `notif-test-${this.namespace}@furnace.test`,
      name: `Notifications Test ${this.namespace}`,
      created_at: timestamp,
      updated_at: timestamp,
    });
    if (userInsert.error) throw userInsert.error;
    this.cleanupIds.userIds.push(userId);

    const accountsInsert = await this.supabase.from('accounts').insert([
      { id: accountAId, name: `Notifications A ${this.namespace}`, created_at: timestamp, updated_at: timestamp },
      { id: accountBId, name: `Notifications B ${this.namespace}`, created_at: timestamp, updated_at: timestamp },
    ]);
    if (accountsInsert.error) throw accountsInsert.error;
    this.cleanupIds.accountIds.push(accountAId, accountBId);

    const membershipsInsert = await this.supabase.from('account_users').insert([
      { id: accountUserAId, account_id: accountAId, user_id: userId, is_owner: true, created_at: timestamp, updated_at: timestamp },
      { id: accountUserBId, account_id: accountBId, user_id: userId, is_owner: false, created_at: timestamp, updated_at: timestamp },
    ]);
    if (membershipsInsert.error) throw membershipsInsert.error;
    this.cleanupIds.accountUserIds.push(accountUserAId, accountUserBId);

    const prefInsert = await this.supabase.from('notification_preferences').insert({
      id: prefAId,
      user_id: userId,
      account_id: accountAId,
      event_type: 'email.received',
      channel: 'web_push',
      enabled: true,
      frequency: 'instant',
      created_at: timestamp,
      updated_at: timestamp,
    });
    if (prefInsert.error) throw prefInsert.error;
    this.cleanupIds.preferenceIds.push(prefAId);

    const subsInsert = await this.supabase.from('push_subscriptions').insert([
      {
        id: sub1Id,
        user_id: userId,
        endpoint: `https://push.example/${this.namespace}/1`,
        p256dh: `p256dh-${this.namespace}-1`,
        auth: `auth-${this.namespace}-1`,
        user_agent: `NotificationsHarness/${this.namespace}`,
        last_seen_at: timestamp,
        revoked_at: null,
        created_at: timestamp,
      },
      {
        id: sub2Id,
        user_id: userId,
        endpoint: `https://push.example/${this.namespace}/2`,
        p256dh: `p256dh-${this.namespace}-2`,
        auth: `auth-${this.namespace}-2`,
        user_agent: `NotificationsHarness/${this.namespace}`,
        last_seen_at: timestamp,
        revoked_at: null,
        created_at: timestamp,
      },
    ]);
    if (subsInsert.error) throw subsInsert.error;
    this.cleanupIds.pushSubscriptionIds.push(sub1Id, sub2Id);

    return { userId, accountAId, accountBId, pushSubscriptionIds: [sub1Id, sub2Id] };
  }

  async cleanup(): Promise<void> {
    await this.deleteRowsByIds('notification_preferences', this.cleanupIds.preferenceIds);
    await this.deleteRowsByIds('push_subscriptions', this.cleanupIds.pushSubscriptionIds);
    await this.deleteRowsByIds('account_users', this.cleanupIds.accountUserIds);
    await this.deleteRowsByIds('accounts', this.cleanupIds.accountIds);
    await this.deleteRowsByIds('users', this.cleanupIds.userIds);
  }

  private async deleteRowsByIds(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase.from(table as any).delete().in('id', ids);
    if (error) throw error;
  }
}
