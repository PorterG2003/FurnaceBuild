import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInboxNotificationActionUrl,
  processNotificationRecord,
  sendWebPushDeliveries,
} from './handler.js';

type PrefRow = { enabled: boolean; frequency: string | null } | null;
type DeliveryRow = { id: string; status: string; error?: string; delivered_at?: string };
type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  revoked_at: string | null;
};
type MemberPrefs = {
  inApp?: PrefRow;
  webPush?: PrefRow;
};

function createFakeSupabase(params?: {
  pushSubscriptions?: PushSubRow[];
  webPushPref?: PrefRow;
  inAppPref?: PrefRow;
  /** When set, overrides global prefs per user_id. */
  prefsByUser?: Record<string, MemberPrefs>;
  memberUserIds?: string[];
  /** Existing notification rows keyed by `${eventId}:${userId}`. */
  existingByUser?: Record<string, { id: string }>;
  notificationEvent?: Record<string, unknown> | null;
  mailbox?: { id: string } | null;
}) {
  const pushSubscriptions = [...(params?.pushSubscriptions ?? [])];
  const deliveries: DeliveryRow[] = [];
  const notificationsInserted: Array<Record<string, unknown>> = [];
  const pushSubscriptionEqCalls: Array<[string, unknown]> = [];
  const pushSubscriptionIsCalls: Array<[string, unknown]> = [];
  const memberUserIds = params?.memberUserIds ?? ['user-1'];
  const prefsByUser = params?.prefsByUser ?? {};
  const existingByUser: Record<string, { id: string }> = { ...(params?.existingByUser ?? {}) };
  let notifSeq = 0;

  const state = {
    notificationEvent:
      params?.notificationEvent === null
        ? null
        : (params?.notificationEvent ?? {
            id: 'evt-1',
            account_id: 'acct-1',
            event_type: 'email.received',
            payload: {
              email_message_id: 'email-1',
              thread_id: 'thread-1',
              mailbox_id: 'mailbox-1',
              from_email: 'person@example.com',
              from_name: 'Person Example',
              subject: 'Hello',
              received_at: '2026-05-08T00:00:00.000Z',
            },
          }),
    mailbox: params?.mailbox === null ? null : (params?.mailbox ?? { id: 'mailbox-1' }),
    inAppPref: params?.inAppPref ?? { enabled: true, frequency: 'instant' },
    webPushPref: params?.webPushPref ?? { enabled: true, frequency: 'instant' },
    emailMessage: { body_text: 'Body preview text', body_html: null as string | null },
    pushSubscriptions,
    deliveries,
    notificationsInserted,
    pushSubscriptionEqCalls,
    pushSubscriptionIsCalls,
    memberUserIds,
    existingByUser,
  };

  const supabase = {
    from(table: string) {
      if (table === 'notification_events') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: state.notificationEvent, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'mailboxes') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: state.mailbox, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'account_users') {
        return {
          select() {
            return {
              async eq(column: string, value: unknown) {
                assert.equal(column, 'account_id');
                assert.equal(value, 'acct-1');
                return {
                  data: state.memberUserIds.map((user_id) => ({ user_id })),
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === 'notifications') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            return {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return this;
              },
              async maybeSingle() {
                const key = `${filters.event_id}:${filters.user_id}`;
                return { data: state.existingByUser[key] ?? null, error: null };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            state.notificationsInserted.push(row);
            notifSeq += 1;
            const id = `notif-${notifSeq}`;
            const key = `${row.event_id}:${row.user_id}`;
            state.existingByUser[key] = { id };
            return {
              select() {
                return {
                  async single() {
                    return { data: { id }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'notification_preferences') {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            return {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return this;
              },
              async maybeSingle() {
                const userId = String(filters.user_id ?? '');
                const perUser = prefsByUser[userId];
                let row: PrefRow = null;
                if (filters.channel === 'in_app') {
                  row = perUser?.inApp !== undefined ? perUser.inApp : state.inAppPref;
                } else if (filters.channel === 'web_push') {
                  row = perUser?.webPush !== undefined ? perUser.webPush : state.webPushPref;
                }
                return { data: row, error: null };
              },
            };
          },
        };
      }

      if (table === 'email_messages') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: state.emailMessage, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'push_subscriptions') {
        return {
          select() {
            return {
              eq(column: string, value: unknown) {
                pushSubscriptionEqCalls.push([column, value]);
                return {
                  async is(isColumn: string, isValue: unknown) {
                    pushSubscriptionIsCalls.push([isColumn, isValue]);
                    return {
                      data: state.pushSubscriptions.filter((sub) => sub.revoked_at === null),
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            return {
              async eq(column: string, value: unknown) {
                assert.equal(column, 'id');
                const target = state.pushSubscriptions.find((sub) => sub.id === value);
                if (target && typeof values.revoked_at === 'string') {
                  target.revoked_at = values.revoked_at;
                }
                return { error: null };
              },
            };
          },
        };
      }

      if (table === 'notification_deliveries') {
        return {
          insert(row: Record<string, unknown>) {
            const delivery: DeliveryRow = {
              id: `delivery-${deliveries.length + 1}`,
              status: String(row.status),
            };
            deliveries.push(delivery);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: delivery.id }, error: null };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            return {
              async eq(column: string, value: unknown) {
                assert.equal(column, 'id');
                const delivery = deliveries.find((row) => row.id === value);
                if (delivery) {
                  Object.assign(delivery, values);
                }
                return { error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return { supabase, state };
}

test('buildInboxNotificationActionUrl is path only', () => {
  assert.equal(buildInboxNotificationActionUrl('thread-1'), '/inbox/thread-1');
});

test('processNotificationRecord still inserts an in-app notification when web push is muted', async () => {
  const { supabase, state } = createFakeSupabase({
    inAppPref: { enabled: true, frequency: 'instant' },
    webPushPref: { enabled: false, frequency: 'muted' },
  });
  let pushCallCount = 0;

  const result = await processNotificationRecord({
    record: { body: JSON.stringify({ eventId: 'evt-1' }), messageId: 'msg-1' },
    supabase: supabase as any,
    webPushReady: true,
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {
      pushCallCount += 1;
    },
  });

  assert.deepEqual(result, {});
  assert.equal(pushCallCount, 0);
  assert.equal(state.notificationsInserted.length, 1);
  assert.equal(state.notificationsInserted[0]?.user_id, 'user-1');
  assert.equal(state.notificationsInserted[0]?.action_url, '/inbox/thread-1');
});

test('processNotificationRecord fans out to every account member with their own prefs', async () => {
  const { supabase, state } = createFakeSupabase({
    memberUserIds: ['owner-1', 'member-2'],
    prefsByUser: {
      'owner-1': {
        inApp: { enabled: true, frequency: 'instant' },
        webPush: { enabled: false, frequency: 'muted' },
      },
      'member-2': {
        inApp: { enabled: true, frequency: 'instant' },
        webPush: { enabled: true, frequency: 'instant' },
      },
    },
    pushSubscriptions: [
      { id: 'sub-m2', endpoint: 'https://push.example/m2', p256dh: 'p2', auth: 'a2', revoked_at: null },
    ],
  });
  const pushUsers: string[] = [];

  const result = await processNotificationRecord({
    record: { body: JSON.stringify({ eventId: 'evt-1' }), messageId: 'msg-1' },
    supabase: supabase as any,
    webPushReady: true,
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {
      pushUsers.push('member-2');
    },
  });

  assert.deepEqual(result, {});
  assert.deepEqual(
    state.notificationsInserted.map((row) => row.user_id),
    ['owner-1', 'member-2']
  );
  assert.equal(pushUsers.length, 1);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]?.status, 'delivered');
});

test('processNotificationRecord still inserts for member B when A already has a row', async () => {
  const { supabase, state } = createFakeSupabase({
    memberUserIds: ['user-a', 'user-b'],
    existingByUser: { 'evt-1:user-a': { id: 'notif-existing-a' } },
    prefsByUser: {
      'user-a': {
        inApp: { enabled: true, frequency: 'instant' },
        webPush: { enabled: true, frequency: 'instant' },
      },
      'user-b': {
        inApp: { enabled: true, frequency: 'instant' },
        webPush: { enabled: false, frequency: 'muted' },
      },
    },
  });

  const result = await processNotificationRecord({
    record: { body: JSON.stringify({ eventId: 'evt-1' }), messageId: 'msg-1' },
    supabase: supabase as any,
    webPushReady: true,
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {
      throw new Error('should not push');
    },
  });

  assert.deepEqual(result, {});
  assert.equal(state.notificationsInserted.length, 1);
  assert.equal(state.notificationsInserted[0]?.user_id, 'user-b');
});

test('processNotificationRecord does not let a muted owner block a member with push on', async () => {
  const { supabase, state } = createFakeSupabase({
    memberUserIds: ['owner-muted', 'member-push'],
    prefsByUser: {
      'owner-muted': {
        inApp: { enabled: false, frequency: 'muted' },
        webPush: { enabled: false, frequency: 'muted' },
      },
      'member-push': {
        inApp: { enabled: false, frequency: 'muted' },
        webPush: { enabled: true, frequency: 'instant' },
      },
    },
    pushSubscriptions: [
      {
        id: 'sub-1',
        endpoint: 'https://push.example/1',
        p256dh: 'p1',
        auth: 'a1',
        revoked_at: null,
      },
    ],
  });
  let pushCalls = 0;

  const result = await processNotificationRecord({
    record: { body: JSON.stringify({ eventId: 'evt-1' }), messageId: 'msg-1' },
    supabase: supabase as any,
    webPushReady: true,
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {
      pushCalls += 1;
    },
  });

  assert.deepEqual(result, {});
  assert.equal(state.notificationsInserted.length, 1);
  assert.equal(state.notificationsInserted[0]?.user_id, 'member-push');
  assert.equal(pushCalls, 1);
});

test('processNotificationRecord retries when notification_events row is missing', async () => {
  const { supabase } = createFakeSupabase({
    notificationEvent: null,
  });

  const result = await processNotificationRecord({
    record: { body: JSON.stringify({ eventId: 'evt-missing' }), messageId: 'msg-missing' },
    supabase: supabase as any,
    webPushReady: true,
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {},
  });

  assert.deepEqual(result, { itemIdentifier: 'msg-missing' });
});

test('sendWebPushDeliveries fans out to every active subscription for the user', async () => {
  const { supabase, state } = createFakeSupabase({
    pushSubscriptions: [
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1', revoked_at: null },
      { id: 'sub-2', endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2', revoked_at: null },
    ],
  });
  const pushCalls: Array<{ endpoint: string; payload: string }> = [];

  await sendWebPushDeliveries({
    supabase: supabase as any,
    userId: 'user-1',
    accountId: 'acct-1',
    notificationId: 'notif-1',
    eventId: 'evt-1',
    title: 'Person Example',
    bodyText: 'Body preview text',
    actionUrl: buildInboxNotificationActionUrl('thread-1'),
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification(subscription, payload) {
      pushCalls.push({ endpoint: subscription.endpoint, payload: String(payload) });
    },
  });

  assert.equal(pushCalls.length, 2);
  assert.deepEqual(
    pushCalls.map((call) => call.endpoint),
    ['https://push.example/1', 'https://push.example/2']
  );
  assert.match(pushCalls[0]!.payload, /\/inbox\/thread-1/);
  assert.deepEqual(state.pushSubscriptionEqCalls, [['user_id', 'user-1']]);
  assert.deepEqual(state.pushSubscriptionIsCalls, [['revoked_at', null]]);
  assert.deepEqual(
    state.deliveries.map((row) => row.status),
    ['delivered', 'delivered']
  );
});

test('sendWebPushDeliveries revokes a 410 subscription and marks the delivery failed', async () => {
  const { supabase, state } = createFakeSupabase({
    pushSubscriptions: [
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1', revoked_at: null },
    ],
  });

  await sendWebPushDeliveries({
    supabase: supabase as any,
    userId: 'user-1',
    accountId: 'acct-1',
    notificationId: 'notif-1',
    eventId: 'evt-1',
    title: 'Person Example',
    bodyText: 'Body preview text',
    actionUrl: buildInboxNotificationActionUrl('thread-1'),
    webOrigin: 'https://build.getfurnace.io',
    async sendNotification() {
      const err = new Error('gone') as Error & { statusCode?: number };
      err.statusCode = 410;
      throw err;
    },
  });

  assert.equal(typeof state.pushSubscriptions[0]?.revoked_at, 'string');
  assert.equal(state.deliveries[0]?.status, 'failed');
  assert.equal(state.deliveries[0]?.error, 'gone');
});
