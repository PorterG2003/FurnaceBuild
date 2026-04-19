import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSlackAggregationStateForTests } from '@furnace/slack-lib';
import { DatabaseClient } from './database.js';

test('DatabaseClient.poll reports one aggregated warning for retryable claim failures', async () => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const calls: string[] = [];

  global.fetch = ((_url, init) => {
    calls.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  const client = new DatabaseClient({
    supabase: {
      rpc: async () => ({
        data: null,
        error: {
          message: 'Could not query the database for the schema cache. Retrying.',
          code: 'PGRST002',
        },
      }),
    } as any,
  });

  try {
    await assert.rejects(() => client.poll());

    assert.equal(calls.length, 1);
    assert.match(calls[0], /Scheduler: error claiming enrollments from database/);
    assert.match(calls[0], /\[WARNING\]/);
  } finally {
    resetSlackAggregationStateForTests();
    global.fetch = originalFetch;
    if (originalWebhook === undefined) {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
    } else {
      process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
    }
  }
});
