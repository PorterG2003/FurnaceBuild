import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSlackAggregationStateForTests } from '@furnace/slack-lib';
import { InboxCheckerWorker } from './worker.js';
import type { Mailbox } from './types.js';

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

type RecordedCall = {
  table: string;
  updates: Record<string, unknown> | null;
  filters: Array<{ op: string; column: string; value: unknown }>;
};

class MutationStub implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private readonly call: RecordedCall,
    private readonly result: { data: any; error: any } = { data: null, error: null },
  ) {}

  update(payload: Record<string, unknown>) {
    this.call.updates = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class TrackingSupabase {
  readonly calls: RecordedCall[] = [];

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
    };
    this.calls.push(call);
    return new MutationStub(call);
  }
}

function createMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    account_id: 'account-1',
    user_id: 'user-1',
    email_address: 'kyle@gofurnacemail.com',
    display_name: 'Kyle',
    provider: 'custom',
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'kyle',
    smtp_password: 'secret',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_username: 'kyle',
    imap_password: 'secret',
    imap_use_ssl: true,
    status: 'connected',
    last_synced_at: null,
    error_message: null,
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-07T00:00:00.000Z',
    ...overrides,
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

test('InboxCheckerWorker aggregates Slack alerts by IMAP host and failure kind', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const mailboxA = createMailbox({ id: 'mailbox-a', email_address: 'a@example.com' });
  const mailboxB = createMailbox({ id: 'mailbox-b', email_address: 'b@example.com' });

  (worker as any).imapClient = {
    async fetchNewMessages() {
      throw {
        message: 'Command failed',
        responseStatus: 'NO',
        responseText: 'Authentication failed',
      };
    },
  };

  try {
    await assert.rejects((worker as any).processMailbox(mailboxA));
    await assert.rejects((worker as any).processMailbox(mailboxB));

    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Inbox-checker failed to process mailbox/);
    assert.match(slack.calls[0], /\[WARNING\]/);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker marks permanent IMAP failures as error and aggregates Slack alerts', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const mailbox = createMailbox();

  (worker as any).imapClient = {
    async fetchNewMessages() {
      throw {
        message: 'Command failed',
        responseStatus: 'NO',
        responseText: 'Authentication failed',
      };
    },
  };

  try {
    await assert.rejects(
      (worker as any).processMailbox(mailbox),
      (error: any) => error?.message === 'Command failed'
    );
    await assert.rejects(
      (worker as any).processMailbox(mailbox),
      (error: any) => error?.message === 'Command failed'
    );

    assert.equal(supabase.calls.length, 2);
    assert.deepEqual(supabase.calls[0].updates, {
      status: 'error',
      error_message: 'Command failed — NO Authentication failed',
      imap_claimed_at: null,
    });
    assert.deepEqual(supabase.calls[0].filters, [
      { op: 'eq', column: 'id', value: 'mailbox-1' },
    ]);
    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Inbox-checker failed to process mailbox/);
    assert.match(slack.calls[0], /\[WARNING\]/);
  } finally {
    slack.restore();
  }
});
