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
    private readonly result: { data: any; error: any } = { data: null, error: null }
  ) {}

  update(payload: Record<string, unknown>) {
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
    return Promise.resolve(this.result);
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
      return '<provider@example.com>';
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
  (worker as any).getFirstSentMessageForCampaignLead = async () => null;
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
