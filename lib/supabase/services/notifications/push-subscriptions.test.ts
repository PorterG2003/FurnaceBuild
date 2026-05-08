import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listActivePushSubscriptionsWithClient,
  upsertPushSubscriptionWithClient,
  type PushSubscriptionKeys,
} from './push-subscriptions-core';

function createPushSubscriptionsClient() {
  const calls = {
    upsert: null as null | { values: Record<string, unknown>; options: { onConflict: string } },
    select: null as null | { columns: string; eq: Array<[string, unknown]>; is: Array<[string, unknown]> },
  };

  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-123' } }, error: null };
      },
    },
    from(table: string) {
      assert.equal(table, 'push_subscriptions');
      return {
        async upsert(values: Record<string, unknown>, options: { onConflict: string }) {
          calls.upsert = { values, options };
          return { error: null };
        },
        select(columns: string) {
          const eqCalls: Array<[string, unknown]> = [];
          const isCalls: Array<[string, unknown]> = [];
          calls.select = { columns, eq: eqCalls, is: isCalls };
          return {
            eq(column: string, value: unknown) {
              eqCalls.push([column, value]);
              return {
                async is(isColumn: string, isValue: unknown) {
                  isCalls.push([isColumn, isValue]);
                  return { data: [{ endpoint: 'https://push.example/sub-1' }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

test('upsertPushSubscriptionWithClient stores a user-scoped endpoint', async () => {
  const { client, calls } = createPushSubscriptionsClient();
  const keys: PushSubscriptionKeys = {
    endpoint: 'https://push.example/sub-1',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
  };

  await upsertPushSubscriptionWithClient(client as any, keys, 'TestAgent/1.0');

  assert.deepEqual(calls.upsert?.options, { onConflict: 'user_id,endpoint' });
  assert.equal(calls.upsert?.values.user_id, 'user-123');
  assert.equal(calls.upsert?.values.endpoint, keys.endpoint);
  assert.equal(calls.upsert?.values.p256dh, keys.p256dh);
  assert.equal(calls.upsert?.values.auth, keys.auth);
  assert.equal(calls.upsert?.values.user_agent, 'TestAgent/1.0');
  assert.equal('account_id' in (calls.upsert?.values ?? {}), false);
  assert.equal(calls.upsert?.values.revoked_at, null);
});

test('listActivePushSubscriptionsWithClient filters only by user and revoked state', async () => {
  const { client, calls } = createPushSubscriptionsClient();

  const subs = await listActivePushSubscriptionsWithClient(client as any);

  assert.deepEqual(subs, [{ endpoint: 'https://push.example/sub-1' }]);
  assert.equal(calls.select?.columns, 'endpoint');
  assert.deepEqual(calls.select?.eq, [['user_id', 'user-123']]);
  assert.deepEqual(calls.select?.is, [['revoked_at', null]]);
});
