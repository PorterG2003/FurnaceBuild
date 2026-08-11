import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitEmailReceivedNotification,
  enqueueNotificationEvent,
} from './emit-notification-event.js';

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

function createFakeSupabase(options: {
  insertResult: QueryResult;
  lookupResult?: QueryResult;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const lookups: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      assert.equal(table, 'notification_events');
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return {
            select() {
              return {
                async single() {
                  return options.insertResult;
                },
              };
            },
          };
        },
        select() {
          const filters: Record<string, unknown> = {};
          return {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return this;
            },
            async maybeSingle() {
              lookups.push({ ...filters });
              return options.lookupResult ?? { data: null, error: null };
            },
          };
        },
      };
    },
  };

  return { supabase, inserts, lookups };
}

test('enqueueNotificationEvent is a no-op when NOTIFICATION_QUEUE_URL is unset', async () => {
  const prev = process.env.NOTIFICATION_QUEUE_URL;
  delete process.env.NOTIFICATION_QUEUE_URL;
  let calls = 0;
  try {
    const ok = await enqueueNotificationEvent('evt-1', {
      async sendMessage() {
        calls += 1;
      },
    });
    assert.equal(ok, false);
    assert.equal(calls, 0);
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_QUEUE_URL;
    else process.env.NOTIFICATION_QUEUE_URL = prev;
  }
});

test('enqueueNotificationEvent retries SQS failures then succeeds', async () => {
  const prev = process.env.NOTIFICATION_QUEUE_URL;
  process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.example/queue';
  let calls = 0;
  try {
    const ok = await enqueueNotificationEvent('evt-retry', {
      maxAttempts: 3,
      async sendMessage() {
        calls += 1;
        if (calls < 3) throw new Error('transient');
      },
    });
    assert.equal(ok, true);
    assert.equal(calls, 3);
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_QUEUE_URL;
    else process.env.NOTIFICATION_QUEUE_URL = prev;
  }
});

test('emitEmailReceivedNotification enqueues after a successful insert', async () => {
  const prev = process.env.NOTIFICATION_QUEUE_URL;
  process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.example/queue';
  const { supabase, inserts } = createFakeSupabase({
    insertResult: { data: { id: 'evt-new' }, error: null },
  });
  const sent: string[] = [];
  try {
    await emitEmailReceivedNotification(
      supabase as any,
      {
        accountId: 'acct-1',
        threadId: 'thread-1',
        emailMessageId: 'email-1',
        mailboxId: 'mailbox-1',
        fromEmail: 'a@example.com',
        fromName: 'A',
        subject: 'Hi',
        receivedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        async sendMessage({ eventId }) {
          sent.push(eventId);
        },
      }
    );
    assert.equal(inserts.length, 1);
    assert.deepEqual(sent, ['evt-new']);
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_QUEUE_URL;
    else process.env.NOTIFICATION_QUEUE_URL = prev;
  }
});

test('emitEmailReceivedNotification re-enqueues existing event on 23505', async () => {
  const prev = process.env.NOTIFICATION_QUEUE_URL;
  process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.example/queue';
  const { supabase, lookups } = createFakeSupabase({
    insertResult: {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    },
    lookupResult: { data: { id: 'evt-existing' }, error: null },
  });
  const sent: string[] = [];
  try {
    await emitEmailReceivedNotification(
      supabase as any,
      {
        accountId: 'acct-1',
        threadId: 'thread-1',
        emailMessageId: 'email-1',
        mailboxId: 'mailbox-1',
        fromEmail: 'a@example.com',
        fromName: null,
        subject: 'Hi',
        receivedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        async sendMessage({ eventId }) {
          sent.push(eventId);
        },
      }
    );
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0]?.account_id, 'acct-1');
    assert.equal(lookups[0]?.dedupe_key, 'email.received:email-1');
    assert.deepEqual(sent, ['evt-existing']);
  } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_QUEUE_URL;
    else process.env.NOTIFICATION_QUEUE_URL = prev;
  }
});
