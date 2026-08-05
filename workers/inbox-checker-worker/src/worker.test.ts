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
    recovery: { runOnStart: false },
  });

  (worker as any).sleep = async () => {
    worker.stop();
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
    recovery: { runOnStart: false },
  });

  (worker as any).sleep = async () => {
    worker.stop();
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

test('InboxCheckerWorker does not Slack-alert on per-mailbox IMAP failures', async () => {
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

    assert.equal(slack.calls.length, 0);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker marks permanent IMAP failures as error', async () => {
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

    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0].updates?.status, 'error');
    assert.match(String(supabase.calls[0].updates?.error_message), /Authentication failed/);
    assert.equal(supabase.calls[0].updates?.imap_claimed_at, null);
    assert.equal(supabase.calls[0].updates?.imap_next_check_at, null);
    assert.equal(supabase.calls[0].updates?.imap_consecutive_failures, 1);
    assert.deepEqual(supabase.calls[0].filters, [
      { op: 'eq', column: 'id', value: 'mailbox-1' },
    ]);
    assert.equal(slack.calls.length, 0);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker backs off transient IMAP failures without demoting immediately', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const mailbox = createMailbox({ imap_consecutive_failures: 0 });

  (worker as any).imapClient = {
    async fetchNewMessages() {
      throw {
        message: 'connect ECONNREFUSED',
        code: 'ECONNREFUSED',
      };
    },
  };

  try {
    await assert.rejects((worker as any).processMailbox(mailbox));
    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0].updates?.status, undefined);
    assert.equal(supabase.calls[0].updates?.imap_consecutive_failures, 1);
    assert.equal(supabase.calls[0].updates?.imap_last_error_code, 'ECONNREFUSED');
    assert.ok(typeof supabase.calls[0].updates?.imap_next_check_at === 'string');
    assert.equal(slack.calls.length, 0);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker advances schedule on successful empty sync', async () => {
  const supabase = new TrackingSupabase();
  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const mailbox = createMailbox({ imap_consecutive_failures: 2 });

  (worker as any).imapClient = {
    async fetchNewMessages() {
      return [];
    },
  };
  (worker as any).threadManager = {
    async retryPendingInboundReplies() {
      return 0;
    },
  };

  await (worker as any).processMailbox(mailbox);

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].updates?.imap_consecutive_failures, 0);
  assert.equal(supabase.calls[0].updates?.error_message, null);
  assert.ok(typeof supabase.calls[0].updates?.last_synced_at === 'string');
  assert.ok(typeof supabase.calls[0].updates?.imap_next_check_at === 'string');
});

test('InboxCheckerWorker alerts when a hot-path batch is all infra failures', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const mailboxes = [
    createMailbox({ id: 'mailbox-a', email_address: 'a@example.com', imap_host: 'host-a.example.com' }),
    createMailbox({ id: 'mailbox-b', email_address: 'b@example.com', imap_host: 'host-b.example.com' }),
  ];
  let claimed = false;

  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        if (claimed) return [];
        claimed = true;
        return mailboxes;
      },
    } as any,
    recovery: { runOnStart: false },
  });

  (worker as any).imapClient = {
    async fetchNewMessages() {
      throw { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' };
    },
  };
  (worker as any).sleep = async () => {
    worker.stop();
  };

  try {
    await worker.start();
    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /hot-path systemic IMAP failure/i);
    assert.match(slack.calls[0], /ECONNREFUSED/);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker does not hot-path alert when any mailbox succeeds', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  let fetchCalls = 0;
  let claimed = false;
  const mailboxes = [
    createMailbox({ id: 'mailbox-a', email_address: 'a@example.com' }),
    createMailbox({ id: 'mailbox-b', email_address: 'b@example.com' }),
  ];

  const worker = new InboxCheckerWorker({
    supabase: supabase as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        if (claimed) return [];
        claimed = true;
        return mailboxes;
      },
    } as any,
    recovery: { runOnStart: false },
  });

  (worker as any).imapClient = {
    async fetchNewMessages() {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return [];
      }
      throw { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' };
    },
  };
  (worker as any).sleep = async () => {
    worker.stop();
  };

  try {
    await worker.start();
    assert.equal(slack.calls.length, 0);
  } finally {
    slack.restore();
  }
});

test('InboxCheckerWorker single-flight intervals skip overlapping ticks', async () => {
  const worker = new InboxCheckerWorker({
    supabase: {} as any,
    databaseClient: {} as any,
  });
  (worker as any).running = true;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  let intervalCallback: (() => void) | undefined;
  global.setInterval = ((callback: (...args: any[]) => void) => {
    intervalCallback = callback as () => void;
    return { id: 'timer-1' } as any;
  }) as typeof setInterval;
  global.clearInterval = (() => {}) as typeof clearInterval;

  let resolveTask: (() => void) | undefined;
  let executions = 0;

  try {
    (worker as any).startSingleFlightInterval({
      taskName: 'TEST TASK',
      intervalMs: 1000,
      task: async () => {
        executions += 1;
        await new Promise<void>((resolve) => {
          resolveTask = resolve;
        });
      },
      onError: () => {
        throw new Error('Unexpected task error');
      },
    });

    assert.ok(intervalCallback);

    intervalCallback();
    intervalCallback();
    await Promise.resolve();

    assert.equal(executions, 1);

    resolveTask?.();
    await Promise.resolve();
    await Promise.resolve();

    intervalCallback();
    await Promise.resolve();

    assert.equal(executions, 2);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('InboxCheckerWorker starts IMAP recovery on boot when configured to run immediately', async () => {
  let recoveryClaims = 0;
  const worker = new InboxCheckerWorker({
    supabase: {} as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        return [];
      },
      async claimMailboxesForImapRecovery() {
        recoveryClaims += 1;
        return [];
      },
    } as any,
    recovery: {
      intervalMs: 60_000,
      batchSize: 5,
      cooldownHours: 24,
      concurrency: 1,
      runOnStart: true,
    },
  });

  (worker as any).sleep = async () => {
    await Promise.resolve();
    worker.stop();
  };

  await worker.start();

  assert.equal(recoveryClaims, 1);
});

test('InboxCheckerWorker.stop awaits active batch and clears recovery timer', async () => {
  let batchFinished = false;
  let resolveBatch!: () => void;
  const batch = new Promise<void>((resolve) => {
    resolveBatch = () => {
      batchFinished = true;
      resolve();
    };
  });

  const worker = new InboxCheckerWorker({
    supabase: {} as any,
    databaseClient: {
      async claimMailboxesToCheck() {
        return [];
      },
    } as any,
  });

  const timerHandle = { id: 'imap-recovery' };
  (worker as any).imapRecoveryTimer = timerHandle;
  (worker as any).activeBatch = batch;

  const originalClearInterval = global.clearInterval;
  const cleared: unknown[] = [];
  global.clearInterval = ((handle?: unknown) => {
    cleared.push(handle);
  }) as typeof clearInterval;

  try {
    const stopPromise = worker.stop();
    assert.equal(batchFinished, false);
    resolveBatch();
    await stopPromise;
  } finally {
    global.clearInterval = originalClearInterval;
  }

  assert.equal(batchFinished, true);
  assert.deepEqual(cleared, [timerHandle]);
  assert.equal((worker as any).imapRecoveryTimer, null);
  assert.equal((worker as any).running, false);
});
