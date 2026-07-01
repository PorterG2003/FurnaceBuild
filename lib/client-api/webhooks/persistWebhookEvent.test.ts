import assert from 'node:assert/strict';
import test from 'node:test';
import { persistWebhookEvent } from './persistWebhookEvent.js';

type MockResult = {
  data?: { id: string } | null;
  error?: { code?: string; message: string } | null;
};

function createMockSupabase(insertResult: MockResult) {
  return {
    from(table: string) {
      assert.equal(table, 'webhook_events');
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return insertResult;
                },
              };
            },
          };
        },
      };
    },
  } as never;
}

test('persistWebhookEvent rejects unknown event types', async () => {
  const supabase = createMockSupabase({ data: { id: 'evt-1' } });
  await assert.rejects(
    () =>
      persistWebhookEvent(supabase, {
        accountId: 'acc-1',
        eventType: 'unknown.event',
        payload: {},
        dedupeKey: 'key-1',
      }),
    /Unsupported webhook event type/,
  );
});

test('persistWebhookEvent returns null on dedupe conflict', async () => {
  const supabase = createMockSupabase({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });
  const id = await persistWebhookEvent(supabase, {
    accountId: 'acc-1',
    eventType: 'email.sent',
    payload: { campaign_id: 'camp-1' },
    dedupeKey: 'dedupe-1',
  });
  assert.equal(id, null);
});

test('persistWebhookEvent returns inserted id', async () => {
  const supabase = createMockSupabase({ data: { id: 'evt-123' }, error: null });
  const id = await persistWebhookEvent(supabase, {
    accountId: 'acc-1',
    campaignId: 'camp-1',
    eventType: 'reply.categorized',
    payload: { thread_id: 'thread-1' },
    dedupeKey: 'dedupe-2',
  });
  assert.equal(id, 'evt-123');
});

test('persistWebhookEvent failSilent returns null for unknown types', async () => {
  const supabase = createMockSupabase({ data: { id: 'evt-1' } });
  const id = await persistWebhookEvent(
    supabase,
    {
      accountId: 'acc-1',
      eventType: 'unknown.event',
      payload: {},
      dedupeKey: 'key-1',
    },
    { failSilent: true },
  );
  assert.equal(id, null);
});
