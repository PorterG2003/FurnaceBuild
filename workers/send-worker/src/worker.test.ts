import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSlackAggregationStateForTests } from '@furnace/slack-lib';
import { SendWorker } from './worker.js';
import type { MessageJob } from './types.js';

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
  selectedColumns: string | null;
};

class MutationStub implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private readonly call: RecordedCall,
    private readonly result:
      | { data: any; error: any }
      | (() => { data: any; error: any }) = { data: null, error: null }
  ) {}

  private resolveResult() {
    return typeof this.result === 'function' ? this.result() : this.result;
  }

  update(payload: Record<string, unknown>) {
    this.call.updates = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.call.updates = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.call.filters.push({ op: 'is', column, value });
    return this;
  }

  in(column: string, value: unknown) {
    this.call.filters.push({ op: 'in', column, value });
    return this;
  }

  select(columns?: string) {
    this.call.selectedColumns = columns ?? null;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.resolveResult());
  }

  single() {
    return Promise.resolve(this.resolveResult());
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolveResult()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class TrackingSupabase {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly results: Array<{ data: any; error: any }> = []) {}

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
      selectedColumns: null,
    };
    this.calls.push(call);
    return new MutationStub(call, this.results.shift() ?? { data: null, error: null });
  }
}

class ProcessMessageMutationStub implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private readonly table: string,
    private readonly supabase: ProcessMessageSupabase,
    private updates: Record<string, unknown> | null = null,
  ) {}

  select(_columns?: string) {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.updates = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.updates = payload;
    return this;
  }

  eq(_column: string, _value: unknown) {
    return this;
  }

  in(_column: string, _value: unknown) {
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.supabase.resolveTableResult(this.table, this.updates));
  }

  single() {
    return Promise.resolve(this.supabase.resolveTableResult(this.table, this.updates));
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.supabase.resolveTableResult(this.table, this.updates)).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined,
    );
  }
}

class ProcessMessageRpcStub {
  constructor(
    private readonly fn: string,
    private readonly args: Record<string, unknown>,
    private readonly supabase: ProcessMessageSupabase,
  ) {}

  single() {
    return Promise.resolve(this.supabase.resolveRpcResult(this.fn, this.args));
  }
}

class ProcessMessageSupabase {
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  readonly tableUpdates: Array<{ table: string; updates: Record<string, unknown> }> = [];

  from(table: string) {
    return new ProcessMessageMutationStub(table, this);
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    if (fn === 'check_mailbox_throttle_and_reserve') {
      return new ProcessMessageRpcStub(fn, args, this);
    }
    return Promise.resolve(this.resolveRpcResult(fn, args));
  }

  resolveTableResult(table: string, updates: Record<string, unknown> | null) {
    if (updates != null) {
      this.tableUpdates.push({ table, updates });
    }
    if (table === 'campaigns') {
      return {
        data: {
          account_id: 'account-1',
          status: 'running',
          deleted_at: null,
        },
        error: null,
      };
    }
    if (table === 'enrollments' && updates == null) {
      return {
        data: {
          deleted_at: null,
          state: 'active',
        },
        error: null,
      };
    }
    if (table === 'message_jobs' && updates != null) {
      return {
        data: {
          id: 'message-job-1',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }

  resolveRpcResult(fn: string, _args: Record<string, unknown>) {
    if (fn === 'check_mailbox_throttle_and_reserve') {
      return {
        data: {
          success: true,
          failure_reason: null,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
}

class ReplyRetrySupabase {
  readonly calls: RecordedCall[] = [];
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  readonly retryFloor: string;

  constructor() {
    this.retryFloor = new Date(Date.now() + 30 * 60_000).toISOString();
  }

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
      selectedColumns: null,
    };
    this.calls.push(call);
    return new MutationStub(call, () => this.resolveTableResult(call));
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return {
      single: async () =>
        fn === 'check_mailbox_throttle_and_reserve'
          ? {
              data: {
                success: false,
                failure_reason: 'Minimum gap between sends not met',
              },
              error: null,
            }
          : { data: null, error: null },
    };
  }

  private resolveTableResult(call: RecordedCall) {
    if (call.table === 'campaigns') {
      return {
        data: {
          account_id: 'account-1',
          status: 'running',
          deleted_at: null,
          schedule: {
            timezone: 'America/Chicago',
            start_hour: 9,
            start_minute: 0,
            end_hour: 17,
            end_minute: 0,
            days_of_week: [1, 2, 3, 4, 5],
          },
        },
        error: null,
      };
    }
    if (call.table === 'enrollments' && call.updates == null) {
      if (call.selectedColumns?.includes('next_run_at')) {
        return {
          data: {
            next_run_at: this.retryFloor,
          },
          error: null,
        };
      }
      return {
        data: {
          deleted_at: null,
          state: 'active',
        },
        error: null,
      };
    }
    if (call.table === 'nodes') {
      return { data: null, error: null };
    }
    if (call.table === 'message_jobs' && call.updates == null) {
      return {
        data: {
          status: 'deferred',
          send_wait_reason: 'Waiting for minimum time between sends',
        },
        error: null,
      };
    }
    if (call.table === 'message_jobs' && call.updates != null) {
      return {
        data: {
          id: 'message-job-1',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
}

class ThreadRecordingSupabase {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly insertError: string | null = null) {}

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
      selectedColumns: null,
    };
    this.calls.push(call);
    return new MutationStub(call, () => this.resolveTableResult(call));
  }

  private resolveTableResult(call: RecordedCall) {
    if (call.table === 'email_threads' && call.updates == null) {
      return {
        data: {
          account_id: 'account-1',
          participants: ['owner@example.com', 'lead@example.com'],
          message_count: 2,
          last_message_at: '2026-05-12T20:00:00.000Z',
        },
        error: null,
      };
    }
    if (call.table === 'email_messages' && call.updates == null) {
      if (call.selectedColumns === 'id, received_at, message_job_id') {
        return { data: null, error: null };
      }
      if (call.selectedColumns === 'received_at') {
        return {
          data: [
            { received_at: '2026-05-12T20:00:00.000Z' },
            { received_at: '2026-05-12T21:00:00.000Z' },
            { received_at: '2026-05-12T22:00:00.000Z' },
          ],
          error: null,
        };
      }
    }
    if (call.table === 'email_messages' && call.updates != null) {
      return this.insertError
        ? { data: null, error: { message: this.insertError } }
        : { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

class InboxForwardSupabase {
  readonly calls: RecordedCall[] = [];
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  from(table: string) {
    const call: RecordedCall = {
      table,
      updates: null,
      filters: [],
      selectedColumns: null,
    };
    this.calls.push(call);
    return new MutationStub(call, () => this.resolveTableResult(call));
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    return {
      single: async () =>
        fn === 'check_mailbox_throttle_and_reserve'
          ? {
              data: {
                success: true,
                failure_reason: null,
              },
              error: null,
            }
          : { data: null, error: null },
    };
  }

  private resolveTableResult(call: RecordedCall) {
    if (call.table === 'mailboxes' && call.updates == null) {
      return {
        data: {
          id: 'mailbox-1',
          email_address: 'owner@example.com',
          display_name: 'Owner',
          deleted_at: null,
        },
        error: null,
      };
    }
    if (call.table === 'email_threads' && call.updates == null) {
      return {
        data: {
          account_id: 'account-1',
          participants: ['owner@example.com', 'lead@example.com'],
          message_count: 2,
          last_message_at: '2026-05-12T20:00:00.000Z',
        },
        error: null,
      };
    }
    if (call.table === 'email_messages' && call.updates == null) {
      if (call.selectedColumns === 'id, received_at, message_job_id') {
        return { data: null, error: null };
      }
      if (call.selectedColumns === 'received_at') {
        return {
          data: [
            { received_at: '2026-05-12T20:00:00.000Z' },
            { received_at: '2026-05-12T21:00:00.000Z' },
            { received_at: '2026-05-12T22:00:00.000Z' },
          ],
          error: null,
        };
      }
    }
    if (call.table === 'message_jobs' && call.updates != null && call.selectedColumns === 'id') {
      return {
        data: {
          id: 'forward-job-1',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
}

function createCampaignMessageJob(overrides: Partial<MessageJob> = {}): MessageJob {
  return {
    id: 'message-job-1',
    enrollment_id: 'enrollment-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    mailbox_id: 'mailbox-1',
    node_id: 'node-1',
    message_type: 'campaign',
    status: 'reserved',
    status_reason: null,
    scheduled_at: '2026-05-12T20:00:00.000Z',
    reserved_at: '2026-05-12T20:00:00.000Z',
    sent_at: null,
    provider_message_id: null,
    error_message: null,
    retry_count: 0,
    message_data: {},
    sqs_message_id: null,
    created_at: '2026-05-12T20:00:00.000Z',
    updated_at: '2026-05-12T20:00:00.000Z',
    ...overrides,
  };
}

test('SendWorker reports retryable main-loop failures as aggregated warnings', async () => {
  const slack = setupSlackCapture();
  const worker = new SendWorker({
    supabase: {} as any,
    databaseClient: {
      async pollManual() {
        throw {
          message: 'Could not query the database for the schema cache. Retrying.',
          code: 'PGRST002',
        };
      },
      async poll() {
        return [];
      },
    } as any,
  });

  (worker as any).sleep = async () => {
    (worker as any).running = false;
  };

  try {
    await worker.start();

    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Send-worker main loop error/);
    assert.match(slack.calls[0], /\[WARNING\]/);
    assert.doesNotMatch(slack.calls[0], /\[object Object\]/);
  } finally {
    await worker.stop();
    slack.restore();
  }
});

test('SendWorker keeps non-retryable main-loop failures critical', async () => {
  const slack = setupSlackCapture();
  const worker = new SendWorker({
    supabase: {} as any,
    databaseClient: {
      async pollManual() {
        throw new Error('SMTP configuration missing');
      },
      async poll() {
        return [];
      },
    } as any,
  });

  (worker as any).sleep = async () => {
    (worker as any).running = false;
  };

  try {
    await worker.start();

    assert.equal(slack.calls.length, 1);
    assert.match(slack.calls[0], /Send-worker main loop error/);
    assert.match(slack.calls[0], /\[CRITICAL\]/);
  } finally {
    await worker.stop();
    slack.restore();
  }
});

test('SendWorker defers retryable pre-send campaign failures instead of stopping enrollment', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase([
    { data: { id: 'message-job-1' }, error: null },
    { data: null, error: null },
  ]);
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const messageJob = createCampaignMessageJob();

  (worker as any).loadJobData = async () => {
    throw new Error('Failed to load lead lead-1: upstream request timeout');
  };

  try {
    await (worker as any).processMessageJob(messageJob);

    assert.equal(supabase.calls.length, 2);
    assert.equal(supabase.calls[0].table, 'message_jobs');
    assert.deepEqual(supabase.calls[0].updates?.status, 'deferred');
    assert.deepEqual(supabase.calls[0].updates?.status_reason, 'transient_read_error');
    assert.deepEqual(supabase.calls[0].updates?.reserved_at, null);
    assert.match(String(supabase.calls[0].updates?.error_message), /upstream request timeout/);
    assert.deepEqual(
      supabase.calls[0].filters,
      [
        { op: 'eq', column: 'id', value: 'message-job-1' },
        { op: 'eq', column: 'status', value: 'reserved' },
      ]
    );
    assert.equal(supabase.calls[0].selectedColumns, 'id');
    assert.equal(supabase.calls[1].table, 'enrollments');
    assert.deepEqual(supabase.calls[1].updates?.next_run_at !== undefined, true);
    assert.deepEqual(
      supabase.calls[1].filters,
      [
        { op: 'eq', column: 'id', value: 'enrollment-1' },
        { op: 'eq', column: 'state', value: 'active' },
      ]
    );
    assert.equal(
      slack.calls.some((body) => body.includes('Send-worker failed to process message job')),
      true
    );

    const nextRunAt = supabase.calls[1].updates?.next_run_at;
    assert.equal(typeof nextRunAt, 'string');
    assert.ok(Date.parse(String(nextRunAt)) > Date.now());
  } finally {
    slack.restore();
  }
});

test('SendWorker still fails and stops enrollment for non-retryable pre-send campaign failures', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const messageJob = createCampaignMessageJob();

  (worker as any).loadJobData = async () => {
    throw new Error('SMTP configuration missing');
  };

  try {
    await assert.rejects(
      (worker as any).processMessageJob(messageJob),
      /SMTP configuration missing/
    );

    assert.equal(supabase.calls.length, 2);
    assert.equal(supabase.calls[0].table, 'message_jobs');
    assert.deepEqual(supabase.calls[0].updates?.status, 'failed');
    assert.equal(supabase.calls[1].table, 'enrollments');
    assert.deepEqual(supabase.calls[1].updates?.state, 'stopped');
    assert.equal(
      slack.calls.some((body) => body.includes('Send-worker failed to process message job')),
      true
    );
  } finally {
    slack.restore();
  }
});

for (const messageType of ['campaign_priority', 'campaign_reply'] as const) {
  test(`SendWorker keeps throttled ${messageType} retries on the priority lane`, async () => {
    const supabase = new ReplyRetrySupabase();
    const worker = new SendWorker({
      supabase: supabase as any,
      databaseClient: {} as any,
    });
    const messageJob = createCampaignMessageJob({
      message_type: messageType,
      message_data: { thread_id: 'thread-1' },
    });

    (worker as any).loadJobData = async () => ({
      lead: {
        id: 'lead-1',
        email: 'lead@example.com',
        deleted_at: null,
        mailbox_id: 'mailbox-1',
      },
      mailbox: {
        id: 'mailbox-1',
        email_address: 'owner@example.com',
        display_name: 'Owner',
        deleted_at: null,
      },
      nodeConfig: {
        subject: 'Subject',
        body_html: '<p>Hello</p>',
        body_text: 'Hello',
        template: null,
        body: null,
        editor_mode: 'rich',
      },
    });

    await (worker as any).processMessageJob(messageJob);

    const replyRetryUpdate = supabase.calls.find(
      (call) => call.table === 'message_jobs' && call.updates?.status === 'queued',
    );
    assert.ok(replyRetryUpdate, `${messageType} retry should be re-queued, not left deferred`);
    assert.equal(replyRetryUpdate?.updates?.status_reason, null);
    assert.equal(
      replyRetryUpdate?.updates?.send_wait_reason,
      'Waiting for minimum time between sends',
    );
    assert.equal(typeof replyRetryUpdate?.updates?.scheduled_at, 'string');
    assert.ok(
      Date.parse(String(replyRetryUpdate?.updates?.scheduled_at)) >= Date.parse(supabase.retryFloor),
    );

    const enrollmentUpdate = supabase.calls.find(
      (call) => call.table === 'enrollments' && call.updates?.next_run_at,
    );
    assert.ok(enrollmentUpdate, 'enrollment should stay aligned to the re-queued retry time');
    assert.equal(enrollmentUpdate?.updates?.next_run_at, replyRetryUpdate?.updates?.scheduled_at);
  });

  test(`SendWorker records sent ${messageType} messages in the replied thread`, async () => {
    const supabase = new ThreadRecordingSupabase();
    const worker = new SendWorker({
      supabase: supabase as any,
      databaseClient: {} as any,
    });

    await (worker as any).recordCampaignReplyInThread(
      createCampaignMessageJob({
        id: 'reply-job-1',
        message_type: messageType,
        message_data: { thread_id: 'thread-1' },
      }),
      {
        id: 'mailbox-1',
        email_address: 'owner@example.com',
        display_name: 'Owner',
      },
      {
        id: 'lead-1',
        email: 'lead@example.com',
        first_name: 'Test',
        last_name: 'Lead',
      },
      'Hello',
      '<p>Hello</p>',
      'Hello',
      '<provider@furnace.test>',
      null,
      null,
    );

    const insertCall = supabase.calls.find(
      (call) => call.table === 'email_messages' && call.updates?.message_job_id === 'reply-job-1',
    );
    assert.ok(insertCall, `${messageType} should create an email_messages row`);
    assert.equal(insertCall?.updates?.message_id, 'provider@furnace.test');
    assert.equal(insertCall?.updates?.thread_id, 'thread-1');
    assert.equal(insertCall?.updates?.subject, 'Hello');
    assert.equal(insertCall?.updates?.in_reply_to, null);
    assert.equal(insertCall?.updates?.message_references, null);

    const updateThreadCall = supabase.calls.find(
      (call) => call.table === 'email_threads' && call.updates?.message_count === 3,
    );
    assert.ok(updateThreadCall, 'thread counters should be repaired from the observed message rows');
    assert.equal(
      updateThreadCall?.updates?.last_inbound_at,
      undefined,
      `outbound ${messageType} must not bump last_inbound_at`,
    );
    assert.ok(updateThreadCall?.updates?.last_message_at, 'outbound still updates last_message_at');
  });

  test(`SendWorker surfaces ${messageType} thread persistence failures to Slack`, async () => {
    const slack = setupSlackCapture();
    const supabase = new ThreadRecordingSupabase('insert blocked');
    const worker = new SendWorker({
      supabase: supabase as any,
      databaseClient: {} as any,
    });

    try {
      await (worker as any).recordCampaignReplyInThread(
        createCampaignMessageJob({
          id: 'reply-job-2',
          message_type: messageType,
          message_data: { thread_id: 'thread-2' },
        }),
        {
          id: 'mailbox-1',
          email_address: 'owner@example.com',
          display_name: 'Owner',
        },
        {
          id: 'lead-1',
          email: 'lead@example.com',
          first_name: 'Test',
          last_name: 'Lead',
        },
        'Hello',
        '<p>Hello</p>',
        'Hello',
        '<provider@furnace.test>',
        null,
        null,
      );

      assert.equal(
        slack.calls.some((body) => body.includes('failed to record sent campaign_reply in thread')),
        true,
      );
    } finally {
      slack.restore();
    }
  });
}

test('SendWorker persists successful inbox_forward jobs into thread history', async () => {
  const supabase = new InboxForwardSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });
  const messageJob = createCampaignMessageJob({
    id: 'forward-job-1',
    message_type: 'inbox_forward',
    status: 'reserved',
    message_data: {
      thread_id: 'thread-1',
      to_email: 'target@example.com',
      to_name: 'Target Person',
      cc: ['cc1@example.com', 'cc2@example.com'],
      subject: 'Fwd: Hello',
      body_text: 'Forward body',
      body_html: '<p>Forward body</p>',
      attachments: [
        {
          filename: 'note.txt',
          contentType: 'text/plain',
          content: Buffer.from('hi').toString('base64'),
        },
      ],
    },
  });

  (worker as any).smtpPool = {
    getTransporter: async () => ({
      sendMail: async () => ({ messageId: '<forward@furnace.test>' }),
    }),
    markMessageSent: () => {},
    removeTransporter: () => {},
  };

  await (worker as any).processInboxForwardJob(messageJob);

  const insertCall = supabase.calls.find(
    (call) => call.table === 'email_messages' && call.updates?.message_job_id === 'forward-job-1',
  );
  assert.ok(insertCall, 'inbox_forward should create an email_messages row');
  assert.equal(insertCall?.updates?.thread_id, 'thread-1');
  assert.equal(insertCall?.updates?.message_id, 'forward@furnace.test');
  assert.equal(insertCall?.updates?.in_reply_to, null);
  assert.equal(insertCall?.updates?.message_references, null);
  assert.deepEqual(insertCall?.updates?.attachments, [
    {
      filename: 'note.txt',
      contentType: 'text/plain',
      size: 2,
    },
  ]);

  const finalJobUpdate = supabase.calls.find(
    (call) => call.table === 'message_jobs' && call.updates?.status === 'sent',
  );
  assert.ok(finalJobUpdate, 'message job should be marked sent');
  assert.equal(finalJobUpdate?.updates?.provider_message_id, '<forward@furnace.test>');

  const threadUpdate = supabase.calls.find(
    (call) => call.table === 'email_threads' && call.updates?.message_count === 3,
  );
  assert.ok(threadUpdate, 'thread metadata should be recomputed after persisting the forward');
  assert.equal(
    threadUpdate?.updates?.last_inbound_at,
    undefined,
    'outbound inbox_forward must not bump last_inbound_at',
  );
  assert.ok(threadUpdate?.updates?.last_message_at, 'outbound still updates last_message_at');
});

test('SendWorker marks mailbox smtp_status=error for permanent SMTP auth failures', async () => {
  const supabase = new TrackingSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });

  await (worker as any).markMailboxSmtpFailureIfPermanent('mailbox-1', {
    code: 'EAUTH',
    message: 'Invalid login',
  });

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].table, 'mailboxes');
  assert.deepEqual(supabase.calls[0].updates, {
    smtp_status: 'error',
    error_message: 'Invalid login',
  });
  assert.deepEqual(supabase.calls[0].filters, [
    { op: 'eq', column: 'id', value: 'mailbox-1' },
  ]);
});

test('SendWorker locks lead mailbox after first successful campaign send', async () => {
  const supabase = new TrackingSupabase([{ data: { id: 'lead-1', mailbox_id: 'mailbox-1' }, error: null }]);
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });

  await (worker as any).reconcileLeadMailboxAfterSuccessfulSend(
    createCampaignMessageJob(),
    null,
  );

  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].table, 'leads');
  assert.deepEqual(supabase.calls[0].updates, { mailbox_id: 'mailbox-1' });
  assert.deepEqual(supabase.calls[0].filters, [
    { op: 'eq', column: 'id', value: 'lead-1' },
    { op: 'is', column: 'mailbox_id', value: null },
  ]);
  assert.equal(supabase.calls[0].selectedColumns, 'id, mailbox_id');
});

test('SendWorker warns when locked lead mailbox mismatches sent job mailbox', async () => {
  const slack = setupSlackCapture();
  const supabase = new TrackingSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
  });

  try {
    await (worker as any).reconcileLeadMailboxAfterSuccessfulSend(
      createCampaignMessageJob(),
      'mailbox-other',
    );

    assert.equal(supabase.calls.length, 0);
    assert.equal(
      slack.calls.some((body) => body.includes('locked lead mailbox mismatched sent job mailbox')),
      true,
    );
  } finally {
    slack.restore();
  }
});

test('SendWorker persists rendered text and html payloads for campaign sends', async () => {
  const supabase = new ProcessMessageSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (_transporter, _mailbox, _job, _lead, _subject, _body, _inReplyTo, _references, options) => {
      assert.equal(options?.bodyHtml, 'Hey Casey,<br>Appreciate it for your time.');
      assert.equal(options?.bodyText, 'Hey Casey, Appreciate it for your time.');
      return { submittedMessageId: '<job-1@furnace.build>', providerMessageId: '<provider@example.com>' };
    },
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: '{Hi {{first_name}}|Hello {{first_name}}}',
        body_html: '<p>{Hey|Hello} {{first_name}},</p><p>{Appreciate it|Thanks} for your time.</p>',
        body_text: '{Hey|Hello} {{first_name}},\n\n{Appreciate it|Thanks} for your time.',
      },
    },
  });

  (worker as any).loadJobData = async () => ({
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      mailbox_id: 'mailbox-1',
    },
    mailbox: {
      id: 'mailbox-1',
      email_address: 'sender@example.com',
      display_name: 'Sender',
      signature: null,
    },
    nodeConfig: (messageJob.message_data as any).node_config,
  });
  (worker as any).isEmailBlocked = async () => false;
  (worker as any).getSentJobsForCampaignLeadThread = async () => [];
  (worker as any).finalizeCampaignMessageJobSent = async () => {};
  (worker as any).reconcileLeadMailboxAfterSuccessfulSend = async () => {};
  (worker as any).smtpPool = {
    getTransporter: async () => ({}),
    markMessageSent: () => {},
  };

  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    await (worker as any).processMessageJob(messageJob);
  } finally {
    Math.random = originalRandom;
  }

  const sentEventCall = supabase.rpcCalls.find((call) => call.fn === 'record_sent_event_and_increment');
  assert.ok(sentEventCall);
  const eventData = sentEventCall.args.p_event_data as Record<string, unknown>;
  assert.deepEqual(eventData, {
    provider_message_id: '<provider@example.com>',
    sent_at: eventData.sent_at,
    test_mode: false,
    sent_subject: 'Hi Casey',
    sent_body_html: 'Hey Casey,<br>Appreciate it for your time.',
    sent_body_text: 'Hey Casey, Appreciate it for your time.',
  });
  assert.equal(typeof eventData.sent_at, 'string');
});

test('SendWorker preserves html-mode full-document payloads', async () => {
  const supabase = new ProcessMessageSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (_transporter, _mailbox, _job, _lead, _subject, _body, _inReplyTo, _references, options) => {
      assert.match(String(options?.bodyHtml), /<html>/i);
      assert.match(String(options?.bodyHtml), /<table>/i);
      assert.equal(options?.bodyText, 'Hello Casey');
      return { submittedMessageId: '<job-1@furnace.build>', providerMessageId: '<provider@example.com>' };
    },
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: 'HTML mode',
        editor_mode: 'html',
        body_html: '<!DOCTYPE html><html><body><table><tr><td>Hello {{first_name}}</td></tr></table></body></html>',
        body_text: 'Hello {{first_name}}',
      },
    },
  });

  (worker as any).loadJobData = async () => ({
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      mailbox_id: 'mailbox-1',
    },
    mailbox: {
      id: 'mailbox-1',
      email_address: 'sender@example.com',
      display_name: 'Sender',
      signature: null,
    },
    nodeConfig: (messageJob.message_data as any).node_config,
  });
  (worker as any).isEmailBlocked = async () => false;
  (worker as any).getSentJobsForCampaignLeadThread = async () => [];
  (worker as any).finalizeCampaignMessageJobSent = async () => {};
  (worker as any).reconcileLeadMailboxAfterSuccessfulSend = async () => {};
  (worker as any).smtpPool = {
    getTransporter: async () => ({}),
    markMessageSent: () => {},
  };

  await (worker as any).processMessageJob(messageJob);

  const sentEventCall = supabase.rpcCalls.find((call) => call.fn === 'record_sent_event_and_increment');
  assert.ok(sentEventCall);
  const eventData = sentEventCall.args.p_event_data as Record<string, unknown>;
  assert.match(String(eventData.sent_body_html), /<html>/i);
  assert.equal(eventData.sent_body_text, 'Hello Casey');
});

function stubCampaignSendWorker(
  worker: SendWorker,
  messageJob: MessageJob,
  options?: {
    firstSent?: {
      provider_message_id: string;
      sent_subject: string;
      subjectTemplate?: string;
    } | null;
  },
) {
  (worker as any).loadJobData = async () => ({
    lead: {
      id: 'lead-1',
      email: 'lead@example.com',
      first_name: 'Casey',
      mailbox_id: 'mailbox-1',
    },
    mailbox: {
      id: 'mailbox-1',
      email_address: 'sender@example.com',
      display_name: 'Sender',
      signature: null,
    },
    nodeConfig: (messageJob.message_data as any).node_config,
  });
  (worker as any).isEmailBlocked = async () => false;
  (worker as any).getSentJobsForCampaignLeadThread = async () => {
    if (!options?.firstSent) return [];
    return [
      {
        id: 'first-job-1',
        provider_message_id: options.firstSent.provider_message_id,
        submitted_message_id: options.firstSent.provider_message_id,
        message_data: {
          sent_subject: options.firstSent.sent_subject,
          node_config: {
            subject:
              options.firstSent.subjectTemplate ??
              '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}',
          },
        },
      },
    ];
  };
  (worker as any).finalizeCampaignMessageJobSent = async () => {};
  (worker as any).reconcileLeadMailboxAfterSuccessfulSend = async () => {};
  (worker as any).smtpPool = {
    getTransporter: async () => ({}),
    markMessageSent: () => {},
  };
}

test('SendWorker follow-up with empty subject reuses exact first sent_subject and headers', async () => {
  const supabase = new ProcessMessageSupabase();
  let captured: {
    subject?: string;
    inReplyTo?: string | null;
    references?: string | null;
  } = {};
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (
      _transporter,
      _mailbox,
      _job,
      _lead,
      subject,
      _body,
      inReplyTo,
      references,
    ) => {
      captured = { subject, inReplyTo, references };
      return { submittedMessageId: '<followup-job@furnace.build>', providerMessageId: '<followup@example.com>' };
    },
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: '',
        body_html: '<p>Just let me know!</p>',
        body_text: 'Just let me know!',
      },
    },
  });
  stubCampaignSendWorker(worker, messageJob, {
    firstSent: {
      provider_message_id: '<first@furnace.build>',
      sent_subject: 'Quick Eval and Draft Question',
      subjectTemplate: '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}',
    },
  });

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    await (worker as any).processMessageJob(messageJob);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(captured.subject, 'Quick Eval and Draft Question');
  assert.equal(captured.inReplyTo, '<first@furnace.build>');
  assert.equal(captured.references, '<first@furnace.build>');
});

test('SendWorker follow-up with (No subject) reuses exact first sent_subject', async () => {
  const supabase = new ProcessMessageSupabase();
  let capturedSubject = '';
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (
      _transporter,
      _mailbox,
      _job,
      _lead,
      subject,
    ) => {
      capturedSubject = subject;
      return { submittedMessageId: '<followup-job@furnace.build>', providerMessageId: '<followup@example.com>' };
    },
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: '(No subject)',
        body_html: '<p>Just let me know!</p>',
        body_text: 'Just let me know!',
      },
    },
  });
  stubCampaignSendWorker(worker, messageJob, {
    firstSent: {
      provider_message_id: '<first@furnace.build>',
      sent_subject: 'Quick question',
    },
  });

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    await (worker as any).processMessageJob(messageJob);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(capturedSubject, 'Quick question');
});

test('SendWorker follow-up with intentional subject keeps it and still sets thread headers', async () => {
  const supabase = new ProcessMessageSupabase();
  let captured: {
    subject?: string;
    inReplyTo?: string | null;
    references?: string | null;
  } = {};
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (
      _transporter,
      _mailbox,
      _job,
      _lead,
      subject,
      _body,
      inReplyTo,
      references,
    ) => {
      captured = { subject, inReplyTo, references };
      return { submittedMessageId: '<followup-job@furnace.build>', providerMessageId: '<followup@example.com>' };
    },
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: 'Brand new subject',
        body_html: '<p>Different angle</p>',
        body_text: 'Different angle',
      },
    },
  });
  stubCampaignSendWorker(worker, messageJob, {
    firstSent: {
      provider_message_id: '<first@furnace.build>',
      sent_subject: 'Quick question',
    },
  });

  await (worker as any).processMessageJob(messageJob);

  assert.equal(captured.subject, 'Brand new subject');
  assert.equal(captured.inReplyTo, '<first@furnace.build>');
  assert.equal(captured.references, '<first@furnace.build>');
});

test('SendWorker persists sent_subject onto message_jobs.message_data', async () => {
  const supabase = new ProcessMessageSupabase();
  const worker = new SendWorker({
    supabase: supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async () => ({ submittedMessageId: '<job-1@furnace.build>', providerMessageId: '<provider@example.com>' }),
  });
  const messageJob = createCampaignMessageJob({
    message_data: {
      node_config: {
        subject: '{Hi {{first_name}}|Hello {{first_name}}}',
        body_html: '<p>Hey {{first_name}}</p>',
        body_text: 'Hey {{first_name}}',
      },
      skip_smtp: true,
    },
  });
  stubCampaignSendWorker(worker, messageJob, { firstSent: null });

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    await (worker as any).processMessageJob(messageJob);
  } finally {
    Math.random = originalRandom;
  }

  const persistCall = supabase.tableUpdates.find(
    (call) =>
      call.table === 'message_jobs' &&
      call.updates &&
      typeof (call.updates.message_data as any)?.sent_subject === 'string',
  );
  assert.ok(persistCall, 'expected message_data.sent_subject persistence');
  assert.equal((persistCall.updates.message_data as any).sent_subject, 'Hi Casey');
  assert.equal((messageJob.message_data as any).sent_subject, 'Hi Casey');
});
