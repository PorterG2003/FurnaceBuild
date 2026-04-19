import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSlackAggregationStateForTests } from '@furnace/slack-lib';
import { InboxCheckerWorker } from './worker.js';

function setupSlackCapture() {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.SLACK_ERROR_WEBHOOK_URL;
  const calls: string[] = [];

  global.fetch = ((_url, init) => {
    calls.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  process.env.SLACK_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
  resetSlackAggregationStateForTests();

  return {
    calls,
    restore() {
      resetSlackAggregationStateForTests();
      global.fetch = originalFetch;
      if (originalWebhook === undefined) {
        delete process.env.SLACK_ERROR_WEBHOOK_URL;
      } else {
        process.env.SLACK_ERROR_WEBHOOK_URL = originalWebhook;
      }
    },
  };
}

test('InboxCheckerWorker reports retryable main-loop failures as aggregated warnings', async () => {
  const slack = setupSlackCapture();
  const worker = new InboxCheckerWorker({
    supabase: {} as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        throw {
          message: 'Could not query the database for the schema cache. Retrying.',
          code: 'PGRST002',
        };
      },
    } as any,
  });

  (worker as any).sleep = async () => {
    (worker as any).running = false;
  };

  try {
    await worker.start();

    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Inbox-checker main loop error/);
    assert.match(slack.calls[0], /\[WARNING\]/);
    assert.doesNotMatch(slack.calls[0], /\[object Object\]/);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker keeps non-retryable main-loop failures loud', async () => {
  const slack = setupSlackCapture();
  const worker = new InboxCheckerWorker({
    supabase: {} as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        throw new Error('Mailbox credentials rejected');
      },
    } as any,
  });

  (worker as any).sleep = async () => {
    (worker as any).running = false;
  };

  try {
    await worker.start();

    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Inbox-checker main loop error/);
    assert.match(slack.calls[0], /\[CRITICAL\]/);
  } finally {
    slack.restore();
  }
});
