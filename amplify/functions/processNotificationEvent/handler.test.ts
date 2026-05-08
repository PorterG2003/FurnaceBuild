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

function createFakeSupabase(params?: {
  pushSubscriptions?: PushSubRow[];
  webPushPref?: PrefRow;
  inAppPref?: PrefRow;
}) {
  const pushSubscriptions = [...(params?.pushSubscriptions ?? [])];
  const deliveries: DeliveryRow[] = [];
  const notificationsInserted: Array<Record<string, unknown>> = [];
  const pushSubscriptionEqCalls: Array<[string, unknown]> = [];
  const pushSubscriptionIsCalls: Array<[string, unknown]> = [];

  const state = {
    notificationEvent: {
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
    },
    mailbox: { user_id: 'user-1' },
    existingNotification: null as { id: string } | null,
    inAppPref: params?.inAppPref ?? { enabled: true, frequency: 'instant' },
    webPushPref: params?.webPushPref ?? { enabled: true, frequency: 'instant' },
    emailMessage: { body_text: 'Body preview text', body_html: null as string | null },
    pushSubscriptions,
    deliveries,
    notificationsInserted,
    pushSubscriptionEqCalls,
    pushSubscriptionIsCalls,
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

      if (table === 'notifications') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: state.existingNotification, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            state.notificationsInserted.push(row);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'notif-1' }, error: null };
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
                const row =
                  filters.channel === 'in_app'
                    ? state.inAppPref
                    : filters.channel === 'web_push'
                      ? state.webPushPref
                      : null;
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

test('buildInboxNotificationActionUrl keeps thread and account context', () => {
  assert.equal(
    buildInboxNotificationActionUrl('thread-1', 'acct-1'),
    '/inbox?thread=thread-1&accountId=acct-1'
  );
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
  assert.equal(state.notificationsInserted[0]?.action_url, '/inbox?thread=thread-1&accountId=acct-1');
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
    actionUrl: buildInboxNotificationActionUrl('thread-1', 'acct-1'),
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
  assert.match(pushCalls[0]!.payload, /accountId=acct-1/);
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
    actionUrl: buildInboxNotificationActionUrl('thread-1', 'acct-1'),
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
