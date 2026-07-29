import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadManager } from './thread-manager.js';
import type { Mailbox, MessageJob, ProcessedMessage } from './types.js';

type Response = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
};

type QueryCall = {
  kind: 'query';
  table: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
  orders: Array<{ column: string; options?: Record<string, unknown> }>;
  limits: number[];
  selects: Array<{ columns: string; options?: Record<string, unknown> }>;
  insertPayloads: unknown[];
  singleMode: 'single' | 'maybeSingle' | null;
};

type RpcCall = {
  kind: 'rpc';
  fn: string;
  args: Record<string, unknown>;
};

class MockQueryBuilder implements PromiseLike<Response> {
  constructor(
    private readonly call: QueryCall,
    private readonly response: Response
  ) {}

  select(columns: string, options?: Record<string, unknown>) {
    this.call.selects.push({ columns, options });
    return this;
  }

  insert(payload: unknown) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  upsert(payload: unknown, _options?: Record<string, unknown>) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  update(payload: unknown) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.call.filters.push({ op: 'gte', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.call.filters.push({ op: 'lte', column, value });
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

  filter(column: string, op: string, value: unknown) {
    this.call.filters.push({ op: `filter:${op}`, column, value });
    return this;
  }

  or(value: string) {
    this.call.filters.push({ op: 'or', value });
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.call.orders.push({ column, options });
    return this;
  }

  limit(value: number) {
    this.call.limits.push(value);
    return this;
  }

  maybeSingle() {
    this.call.singleMode = 'maybeSingle';
    return this;
  }

  single() {
    this.call.singleMode = 'single';
    return this;
  }

  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class MockSupabase {
  readonly calls: Array<QueryCall | RpcCall> = [];

  constructor(private readonly responses: Response[]) {}

  from(table: string) {
    const response = this.responses.shift();
    if (!response) throw new Error(`No mock response queued for table ${table}`);

    const call: QueryCall = {
      kind: 'query',
      table,
      filters: [],
      orders: [],
      limits: [],
      selects: [],
      insertPayloads: [],
      singleMode: null,
    };
    this.calls.push(call);
    return new MockQueryBuilder(call, response);
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ kind: 'rpc', fn, args });
    const response = this.responses.shift();
    if (!response) throw new Error(`No mock response queued for rpc ${fn}`);
    return response;
  }
}

type StatefulBounceConfig = {
  jobs: Array<{
    id: string;
    campaign_id: string;
    enrollment_id: string;
    lead_id: string;
    message_type?: string | null;
    sent_at: string;
    created_at?: string;
  }>;
  leads: Array<{ id: string; email: string }>;
  suppressBouncedEmails: boolean;
};

type StoredBounceEvent = {
  id: string;
  mailbox_id: string;
  message_job_id: string;
  event_data: Record<string, unknown>;
  bounce_dedupe_key: string | null;
};

class StatefulQueryBuilder implements PromiseLike<Response> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolver: (call: QueryCall) => Response
  ) {}

  select(columns: string, options?: Record<string, unknown>) {
    this.call.selects.push({ columns, options });
    return this;
  }

  insert(payload: unknown) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  upsert(payload: unknown, _options?: Record<string, unknown>) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  update(payload: unknown) {
    this.call.insertPayloads.push(payload);
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.call.filters.push({ op: 'gte', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.call.filters.push({ op: 'lte', column, value });
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

  filter(column: string, op: string, value: unknown) {
    this.call.filters.push({ op: `filter:${op}`, column, value });
    return this;
  }

  or(value: string) {
    this.call.filters.push({ op: 'or', value });
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.call.orders.push({ column, options });
    return this;
  }

  limit(value: number) {
    this.call.limits.push(value);
    return this;
  }

  maybeSingle() {
    this.call.singleMode = 'maybeSingle';
    return this;
  }

  single() {
    this.call.singleMode = 'single';
    return this;
  }

  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolver(this.call)).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class StatefulBounceSupabase {
  readonly calls: Array<QueryCall | RpcCall> = [];
  readonly bouncedEvents: StoredBounceEvent[] = [];
  private eventCounter = 0;
  private webhookCounter = 0;

  constructor(private readonly config: StatefulBounceConfig) {}

  from(table: string) {
    const call: QueryCall = {
      kind: 'query',
      table,
      filters: [],
      orders: [],
      limits: [],
      selects: [],
      insertPayloads: [],
      singleMode: null,
    };
    this.calls.push(call);
    return new StatefulQueryBuilder(call, (queryCall) => this.resolveQuery(queryCall));
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ kind: 'rpc', fn, args });

    if (fn === 'record_bounced_event_and_increment') {
      const eventData = { ...((args.p_event_data as Record<string, unknown> | undefined) ?? {}) };
      const normalizedMessageId =
        typeof eventData.bounce_message_id === 'string'
          ? eventData.bounce_message_id.trim().replace(/^<|>$/g, '').toLowerCase() || null
          : null;
      const bounceUid =
        eventData.bounce_uid === null || eventData.bounce_uid === undefined
          ? null
          : String(eventData.bounce_uid).trim() || null;
      const bounceDedupeKey = normalizedMessageId
        ? `mid:${normalizedMessageId}`
        : bounceUid
          ? `uid:${bounceUid}`
          : null;
      const existing = this.bouncedEvents.find(
        (event) =>
          event.mailbox_id === String(args.p_mailbox_id) &&
          event.bounce_dedupe_key !== null &&
          event.bounce_dedupe_key === bounceDedupeKey
      );
      if (existing) {
        return { data: false, error: null };
      }

      this.eventCounter += 1;
      this.bouncedEvents.push({
        id: `bounce-event-${this.eventCounter}`,
        mailbox_id: String(args.p_mailbox_id),
        message_job_id: String(args.p_message_job_id),
        event_data: eventData,
        bounce_dedupe_key: bounceDedupeKey,
      });
      return { data: true, error: null };
    }

    if (fn === 'cancel_held_jobs_for_enrollment') {
      return { data: 0, error: null };
    }

    throw new Error(`Unexpected rpc ${fn}`);
  }

  private resolveQuery(call: QueryCall): Response {
    switch (call.table) {
      case 'events':
        return this.resolveEvents(call);
      case 'message_jobs':
        return { data: this.config.jobs, error: null };
      case 'leads':
        return { data: this.config.leads, error: null };
      case 'accounts':
        return {
          data: { suppress_bounced_emails: this.config.suppressBouncedEmails },
          error: null,
        };
      case 'block_list':
      case 'enrollments':
        return { data: null, error: null };
      case 'webhook_events':
        this.webhookCounter += 1;
        return { data: { id: `webhook-event-${this.webhookCounter}` }, error: null };
      default:
        throw new Error(`Unexpected table ${call.table}`);
    }
  }

  private resolveEvents(call: QueryCall): Response {
    const mailboxId = call.filters.find((filter) => filter.op === 'eq' && filter.column === 'mailbox_id')?.value;
    const eventType = call.filters.find((filter) => filter.op === 'eq' && filter.column === 'event_type')?.value;
    const subset = call.filters.find((filter) => filter.op === 'filter:cs' && filter.column === 'event_data')?.value;

    const matches = this.bouncedEvents.filter((event) => {
      if (eventType && eventType !== 'bounced') return false;
      if (mailboxId && event.mailbox_id !== mailboxId) return false;
      if (!subset || typeof subset !== 'object' || Array.isArray(subset)) return true;
      return Object.entries(subset).every(([key, value]) => event.event_data[key] === value);
    });

    if (call.singleMode === 'maybeSingle' || call.singleMode === 'single') {
      return { data: matches[0] ? { id: matches[0].id } : null, error: null };
    }

    return { data: matches.map((event) => ({ id: event.id, event_data: event.event_data })), error: null };
  }
}

function createMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mailbox-1',
    account_id: 'account-1',
    user_id: 'user-1',
    email_address: 'porterg@furnaceoutbound.com',
    display_name: 'Porter',
    provider: 'custom',
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'smtp-user',
    smtp_password: 'smtp-pass',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_username: 'imap-user',
    imap_password: 'imap-pass',
    imap_use_ssl: true,
    status: 'connected',
    last_synced_at: null,
    error_message: null,
    created_at: '2026-04-06T00:00:00.000Z',
    updated_at: '2026-04-06T00:00:00.000Z',
    ...overrides,
  };
}

function createMessageJob(overrides: Partial<MessageJob> = {}): MessageJob {
  return {
    id: 'job-1',
    account_id: 'account-1',
    enrollment_id: 'enrollment-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    mailbox_id: 'mailbox-1',
    node_id: 'node-1',
    message_type: null,
    status: 'sent',
    scheduled_at: '2026-04-05T00:00:00.000Z',
    reserved_at: null,
    sent_at: '2026-04-05T01:00:00.000Z',
    provider_message_id: '<abc@example.com>',
    error_message: null,
    message_data: {},
    created_at: '2026-04-05T00:00:00.000Z',
    updated_at: '2026-04-05T01:00:00.000Z',
    mailboxes: {
      account_id: 'account-1',
      email_address: 'porterg@furnaceoutbound.com',
    },
    leads: {
      email: 'lead@example.com',
      name: 'Lead',
    },
    ...overrides,
  };
}

function createProcessedMessage(overrides: Partial<ProcessedMessage> = {}): ProcessedMessage {
  return {
    uid: 123,
    messageId: '<reply@example.com>',
    inReplyTo: '<abc@example.com>',
    references: null,
    from: { address: 'lead@example.com', name: 'Lead' },
    to: [{ address: 'porterg@furnaceoutbound.com', name: 'Porter' }],
    subject: 'Re: Hello',
    bodyText: 'Reply body',
    bodyHtml: '<p>Reply body</p>',
    date: new Date('2026-04-06T02:58:50.000Z'),
    headers: {},
    attachments: [],
    ...overrides,
  };
}

test('selectReplyJobCandidate prefers same mailbox and exact normalized provider message id', () => {
  const manager = new ThreadManager({} as any);
  const mailbox = createMailbox();
  const selected = (manager as any).selectReplyJobCandidate(
    [
      createMessageJob({
        id: 'job-fuzzy',
        provider_message_id: '<abc@example.com.extra>',
        mailbox_id: 'mailbox-1',
      }),
      createMessageJob({
        id: 'job-email-match',
        mailbox_id: 'mailbox-2',
        mailboxes: {
          account_id: 'account-1',
          email_address: 'porterg@furnaceoutbound.com',
        },
      }),
      createMessageJob({
        id: 'job-same-mailbox',
        mailbox_id: 'mailbox-1',
      }),
    ],
    mailbox,
    'abc@example.com'
  );

  assert.equal(selected?.id, 'job-same-mailbox');
});

test('selectParentMessageCandidate prefers the canonical oldest thread within the same account', () => {
  const manager = new ThreadManager({} as any);
  const mailbox = createMailbox({ id: 'mailbox-1', account_id: 'account-1' });
  const selected = (manager as any).selectParentMessageCandidate(
    [
      {
        id: 'message-newer',
        thread_id: 'thread-newer',
        message_id: 'reply@example.com',
        received_at: '2026-04-06T02:58:51.000Z',
        created_at: '2026-04-06T02:58:51.000Z',
        email_threads: {
          id: 'thread-newer',
          account_id: 'account-1',
          mailbox_id: 'mailbox-1',
          created_at: '2026-04-06T02:58:50.366Z',
          last_message_at: '2026-04-06T02:58:51.000Z',
        },
      },
      {
        id: 'message-older',
        thread_id: 'thread-older',
        message_id: 'reply@example.com',
        received_at: '2026-04-06T02:58:50.900Z',
        created_at: '2026-04-06T02:58:50.900Z',
        email_threads: {
          id: 'thread-older',
          account_id: 'account-1',
          mailbox_id: 'mailbox-1',
          created_at: '2026-04-06T02:58:50.349Z',
          last_message_at: '2026-04-06T02:58:50.900Z',
        },
      },
      {
        id: 'message-other-account',
        thread_id: 'thread-other-account',
        message_id: 'reply@example.com',
        received_at: '2026-04-06T02:58:49.000Z',
        created_at: '2026-04-06T02:58:49.000Z',
        email_threads: {
          id: 'thread-other-account',
          account_id: 'account-2',
          mailbox_id: 'mailbox-9',
          created_at: '2026-04-06T02:58:40.000Z',
          last_message_at: '2026-04-06T02:58:49.000Z',
        },
      },
    ],
    mailbox
  );

  assert.equal(selected?.thread_id, 'thread-older');
});

test('handleReply scopes duplicate detection and job lookup to the mailbox account', async () => {
  const supabase = new MockSupabase([
    { data: [] },
    { data: [] },
    { data: [] },
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox({ account_id: 'account-1' });
  const message = createProcessedMessage({
    messageId: '<reply@example.com>',
    inReplyTo: '<abc@example.com>',
  });

  const handled = await manager.handleReply(mailbox, message);

  assert.equal(handled, false);

  const emailMessageLookup = supabase.calls[0] as QueryCall;
  assert.equal(emailMessageLookup.table, 'email_messages');
  assert.deepEqual(
    emailMessageLookup.filters.find((filter) => filter.column === 'account_id'),
    { op: 'eq', column: 'account_id', value: 'account-1' }
  );

  const messageJobLookup = supabase.calls[1] as QueryCall;
  assert.equal(messageJobLookup.table, 'message_jobs');
  assert.deepEqual(
    messageJobLookup.filters.find((filter) => filter.column === 'account_id'),
    { op: 'eq', column: 'account_id', value: 'account-1' }
  );

  const parentMessageLookup = supabase.calls[2] as QueryCall;
  assert.equal(parentMessageLookup.table, 'email_messages');
  assert.deepEqual(
    parentMessageLookup.filters.find((filter) => filter.column === 'account_id'),
    { op: 'eq', column: 'account_id', value: 'account-1' }
  );
});

test('handleReply treats inbound unsubscribe-like replies as normal replies', async () => {
  const existingThread = {
    id: 'thread-1',
    account_id: 'account-1',
    mailbox_id: 'mailbox-1',
    message_count: 1,
    participants: ['porterg@furnaceoutbound.com', 'lead@example.com'],
    category: null,
  };
  const supabase = new MockSupabase([
    { data: [] },
    {
      data: [
        createMessageJob({
          message_data: { source: 'inbox_reply', thread_id: 'thread-1' } as any,
        } as any),
      ],
    },
    { data: existingThread, error: null },
    { data: { id: 'email-message-1', received_at: '2026-04-06T02:58:50.000Z' }, error: null },
    { count: 2, error: null },
    { data: null, error: null },
    { data: { id: 'notification-event-row-1' }, error: null },
    { data: { id: 'notification-event-1' }, error: null },
    { data: { id: 'webhook-event-1' }, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    bodyText: 'Please unsubscribe me from future emails.',
    subject: 'unsubscribe',
  });

  const handled = await manager.handleReply(mailbox, message);

  assert.equal(handled, true);
  assert.ok(supabase.calls.some((call) => (call as QueryCall).table === 'enrollments'));

  const insertedMessage = supabase.calls.find(
    (call) => (call as QueryCall).table === 'email_messages' && (call as QueryCall).insertPayloads.length > 0
  ) as QueryCall | undefined;
  assert.ok(insertedMessage);

  const notificationInsert = supabase.calls.find(
    (call) => (call as QueryCall).table === 'notification_events'
  ) as QueryCall | undefined;
  assert.ok(notificationInsert);

  const threadUpdateCalls = supabase.calls.filter(
    (call): call is QueryCall =>
      (call as QueryCall).kind === 'query' &&
      (call as QueryCall).table === 'email_threads' &&
      (call as QueryCall).insertPayloads.length > 0 &&
      typeof (call as QueryCall).insertPayloads[0] === 'object' &&
      (call as QueryCall).insertPayloads[0] !== null &&
      'has_reply' in ((call as QueryCall).insertPayloads[0] as object)
  );
  assert.equal(threadUpdateCalls.length, 1);
  const threadUpdatePayload = threadUpdateCalls[0].insertPayloads[0] as Record<string, unknown>;
  assert.equal(threadUpdatePayload.has_reply, true);
  assert.equal(threadUpdatePayload.out_of_office, false);
  assert.equal(threadUpdatePayload.ooo_resume_requested, false);
  assert.equal(threadUpdatePayload.ooo_resume_at, null);
  assert.equal(threadUpdatePayload.ooo_resume_processed_at, null);
});

test('handleReply routes campaign replies on categorizer flows through the park RPC instead of stopping', async () => {
  const existingThread = {
    id: 'thread-1',
    account_id: 'account-1',
    mailbox_id: 'mailbox-1',
    message_count: 1,
    participants: ['porterg@furnaceoutbound.com', 'lead@example.com'],
    category: null,
    category_source: null,
  };
  const supabase = new MockSupabase([
    { data: [] }, // email_messages dup check
    { data: [createMessageJob()] }, // message_jobs search (campaign send)
    { data: [existingThread] }, // getOrCreateThread by message_job_id
    { data: [] }, // backfillSentMessages: no additional jobs
    { data: { id: 'email-message-1', received_at: '2026-04-06T02:58:50.000Z' }, error: null },
    { count: 2, error: null }, // email_messages count
    { data: null, error: null }, // email_threads update
    { data: [{ id: 'node-categorizer' }], error: null }, // nodes (campaignHasCategorizer)
    { data: 'held', error: null }, // rpc park_or_advance_enrollment_on_reply
    { data: true, error: null }, // rpc record_replied_event_and_increment
    { data: { id: 'notification-event-1' }, error: null }, // notification_events
    { data: { id: 'webhook-event-1' }, error: null }, // webhook_events
  ]);
  const manager = new ThreadManager(supabase as any);

  const handled = await manager.handleReply(createMailbox(), createProcessedMessage());

  assert.equal(handled, true);
  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    ['park_or_advance_enrollment_on_reply', 'record_replied_event_and_increment'],
  );
  assert.equal(rpcCalls[0].args.p_enrollment_id, 'enrollment-1');
  assert.equal(rpcCalls[0].args.p_thread_id, 'thread-1');

  // Parked, never stopped: no enrollments update of any kind.
  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'enrollments'));
});

test('handleReply falls back to the legacy hard stop (with held-job hygiene) when the park RPC fails', async () => {
  const existingThread = {
    id: 'thread-1',
    account_id: 'account-1',
    mailbox_id: 'mailbox-1',
    message_count: 1,
    participants: ['porterg@furnaceoutbound.com', 'lead@example.com'],
    category: null,
    category_source: null,
  };
  const supabase = new MockSupabase([
    { data: [] }, // email_messages dup check
    { data: [createMessageJob()] }, // message_jobs search (campaign send)
    { data: [existingThread] }, // getOrCreateThread by message_job_id
    { data: [] }, // backfillSentMessages: no additional jobs
    { data: { id: 'email-message-1', received_at: '2026-04-06T02:58:50.000Z' }, error: null },
    { count: 2, error: null }, // email_messages count
    { data: null, error: null }, // email_threads update
    { data: [{ id: 'node-categorizer' }], error: null }, // nodes (campaignHasCategorizer)
    { data: null, error: { message: 'park exploded' } }, // rpc park (FAILS)
    { data: null, error: null }, // enrollments legacy stop
    { data: 0, error: null }, // rpc cancel_held_jobs_for_enrollment
    { data: true, error: null }, // rpc record_replied_event_and_increment
    { data: { id: 'notification-event-1' }, error: null }, // notification_events
    { data: { id: 'webhook-event-1' }, error: null }, // webhook_events
  ]);
  const manager = new ThreadManager(supabase as any);

  const handled = await manager.handleReply(createMailbox(), createProcessedMessage());

  assert.equal(handled, true);
  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    [
      'park_or_advance_enrollment_on_reply',
      'cancel_held_jobs_for_enrollment',
      'record_replied_event_and_increment',
    ],
  );

  // Fail-safe: halting outbound for someone who replied is always safe.
  const enrollCalls = supabase.calls.filter((c) => (c as QueryCall).table === 'enrollments') as QueryCall[];
  assert.equal(enrollCalls.length, 1);
  assert.match(JSON.stringify(enrollCalls[0].insertPayloads[0]), /"stopped_reason":"replied"/);
});

test('getOrCreateThread reloads the canonical thread after a unique-violation race', async () => {
  const canonicalThread = {
    id: 'thread-1',
    account_id: 'account-1',
    message_job_id: 'job-1',
  };
  const supabase = new MockSupabase([
    { data: [] },
    { data: [] },
    { data: null, error: null },
    { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    { data: [canonicalThread] },
    { data: [] }, // backfillSentMessages: no sent jobs under cutoff
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const messageJob = createMessageJob();

  const thread = await (manager as any).getOrCreateThread(
    messageJob,
    mailbox,
    '2026-04-06T02:58:50.000Z'
  );

  assert.deepEqual(thread, canonicalThread);

  const insertCall = supabase.calls[3] as QueryCall;
  assert.equal(insertCall.table, 'email_threads');
  assert.equal(insertCall.insertPayloads.length, 1);

  const reloadCall = supabase.calls[4] as QueryCall;
  assert.equal(reloadCall.table, 'email_threads');
  assert.deepEqual(
    reloadCall.filters.find((filter) => filter.column === 'message_job_id'),
    { op: 'eq', column: 'message_job_id', value: 'job-1' }
  );
});

test('backfillSentMessages stores rendered event payloads for sent campaign messages', async () => {
  const supabase = new MockSupabase([
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<abc@example.com>',
          sent_at: '2026-04-05T01:00:00.000Z',
          created_at: '2026-04-05T00:00:00.000Z',
          message_data: {
            node_config: {
              body: '{Hey|Hi} {{first_name}}',
            },
          },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    {
      data: [
        {
          message_job_id: 'job-1',
          event_data: {
            sent_subject: 'Hello Casey',
            sent_body_html: 'Hello Casey<br><br>Thanks,<br>Porter',
            sent_body_text: 'Hello Casey Thanks, Porter',
          },
        },
      ],
    },
    { data: [] },
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null },
    { count: 1, error: null },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);

  await (manager as any).backfillSentMessages(
    { id: 'thread-1', account_id: 'account-1' },
    'campaign-1',
    'lead-1',
    '2026-04-06T00:00:00.000Z',
    createMailbox()
  );

  const insertCall = supabase.calls[4] as QueryCall;
  assert.equal(insertCall.table, 'email_messages');
  assert.equal(insertCall.insertPayloads.length, 1);
  assert.deepEqual(insertCall.insertPayloads[0], {
    thread_id: 'thread-1',
    account_id: 'account-1',
    message_job_id: 'job-1',
    direction: 'sent',
    from_email: 'porterg@furnaceoutbound.com',
    from_name: 'Porter',
    to_email: 'lead@example.com',
    to_name: 'Lead',
    subject: 'Hello Casey',
    body_text: 'Hello Casey Thanks, Porter',
    body_html: 'Hello Casey<br><br>Thanks,<br>Porter',
    message_id: 'abc@example.com',
    in_reply_to: null,
    message_references: null,
    received_at: '2026-04-05T01:00:00.000Z',
    headers: {},
    attachments: [],
  });

  const updateCall = supabase.calls[6] as QueryCall;
  assert.equal(updateCall.table, 'email_threads');
  assert.deepEqual(updateCall.insertPayloads[0], { message_count: 1 });
});

test('backfillSentMessages falls back to raw node config when no sent event exists', async () => {
  const supabase = new MockSupabase([
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<abc@example.com>',
          sent_at: '2026-04-05T01:00:00.000Z',
          created_at: '2026-04-05T00:00:00.000Z',
          message_data: {
            subject: 'Fallback subject',
            node_config: {
              body: '{Hey|Hi} {{first_name}}',
              template: '{Fallback|Backup} {{first_name}}',
            },
          },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    { data: [] },
    { data: [] },
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null },
    { count: 1, error: null },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);

  await (manager as any).backfillSentMessages(
    { id: 'thread-1', account_id: 'account-1' },
    'campaign-1',
    'lead-1',
    '2026-04-06T00:00:00.000Z',
    createMailbox()
  );

  const insertCall = supabase.calls[4] as QueryCall;
  assert.equal(insertCall.table, 'email_messages');
  const inserted = insertCall.insertPayloads[0] as Record<string, unknown>;
  assert.equal(inserted.subject, 'Fallback subject');
  assert.equal(inserted.body_text, '{Hey|Hi} {{first_name}}');
  assert.equal(inserted.body_html, '{Hey|Hi} {{first_name}}');
});

test('backfillSentMessages includes campaign sends after matched job sent_at when cutoff is reply time', async () => {
  const jobs = [
    {
      id: 'job-1',
      provider_message_id: '<msg1@furnace.build>',
      sent_at: '2026-07-01T20:00:00.000Z',
      created_at: '2026-07-01T20:00:00.000Z',
      message_data: { subject: 'First' },
      mailbox_id: 'mailbox-1',
      lead_id: 'lead-1',
    },
    {
      id: 'job-2',
      provider_message_id: '<msg2@furnace.build>',
      sent_at: '2026-07-08T18:00:00.000Z',
      created_at: '2026-07-08T18:00:00.000Z',
      message_data: { subject: 'Follow-up 2' },
      mailbox_id: 'mailbox-1',
      lead_id: 'lead-1',
    },
    {
      id: 'job-3',
      provider_message_id: '<msg3@furnace.build>',
      sent_at: '2026-07-13T19:00:00.000Z',
      created_at: '2026-07-13T19:00:00.000Z',
      message_data: { subject: 'Follow-up 3' },
      mailbox_id: 'mailbox-1',
      lead_id: 'lead-1',
    },
  ];
  const replyCutoff = '2026-07-15T09:38:24.000Z';
  const supabase = new MockSupabase([
    { data: jobs },
    {
      data: [
        {
          message_job_id: 'job-1',
          event_data: { sent_subject: 'First', sent_body_html: 'a', sent_body_text: 'a' },
        },
        {
          message_job_id: 'job-2',
          event_data: { sent_subject: 'Follow-up 2', sent_body_html: 'b', sent_body_text: 'b' },
        },
        {
          message_job_id: 'job-3',
          event_data: { sent_subject: 'Follow-up 3', sent_body_html: 'c', sent_body_text: 'c' },
        },
      ],
    },
    { data: [{ message_job_id: 'job-1' }] }, // job-1 already on thread
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null }, // insert job-2
    { data: null, error: null }, // insert job-3
    { count: 3, error: null },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);

  await (manager as any).backfillSentMessages(
    { id: 'thread-1', account_id: 'account-1' },
    'campaign-1',
    'lead-1',
    replyCutoff,
    createMailbox()
  );

  const jobsQuery = supabase.calls[0] as QueryCall;
  assert.deepEqual(
    jobsQuery.filters.find((f) => f.column === 'sent_at' && f.op === 'lte'),
    { op: 'lte', column: 'sent_at', value: replyCutoff }
  );

  const insertCalls = supabase.calls.filter(
    (c): c is QueryCall =>
      (c as QueryCall).kind === 'query' &&
      (c as QueryCall).table === 'email_messages' &&
      (c as QueryCall).insertPayloads.length > 0
  );
  assert.equal(insertCalls.length, 2);
  assert.equal((insertCalls[0].insertPayloads[0] as any).message_job_id, 'job-2');
  assert.equal((insertCalls[0].insertPayloads[0] as any).subject, 'Follow-up 2');
  assert.equal((insertCalls[0].insertPayloads[0] as any).in_reply_to, 'msg1@furnace.build');
  assert.equal((insertCalls[1].insertPayloads[0] as any).message_job_id, 'job-3');
  assert.equal((insertCalls[1].insertPayloads[0] as any).subject, 'Follow-up 3');
});

test('backfillSentMessages with matched-job cutoff still excludes later sends', async () => {
  const matchedJobCutoff = '2026-07-01T20:00:00.000Z';
  const supabase = new MockSupabase([
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<msg1@furnace.build>',
          sent_at: '2026-07-01T20:00:00.000Z',
          created_at: '2026-07-01T20:00:00.000Z',
          message_data: { subject: 'First' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    {
      data: [
        {
          message_job_id: 'job-1',
          event_data: { sent_subject: 'First', sent_body_html: 'a', sent_body_text: 'a' },
        },
      ],
    },
    { data: [] },
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null },
    { count: 1, error: null },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);

  await (manager as any).backfillSentMessages(
    { id: 'thread-1', account_id: 'account-1' },
    'campaign-1',
    'lead-1',
    matchedJobCutoff,
    createMailbox()
  );

  const jobsQuery = supabase.calls[0] as QueryCall;
  assert.deepEqual(
    jobsQuery.filters.find((f) => f.column === 'sent_at' && f.op === 'lte'),
    { op: 'lte', column: 'sent_at', value: matchedJobCutoff }
  );

  const insertCalls = supabase.calls.filter(
    (c): c is QueryCall =>
      (c as QueryCall).kind === 'query' &&
      (c as QueryCall).table === 'email_messages' &&
      (c as QueryCall).insertPayloads.length > 0
  );
  assert.equal(insertCalls.length, 1);
  assert.equal((insertCalls[0].insertPayloads[0] as any).message_job_id, 'job-1');
});

test('handleReply backfills later follow-ups when reply matches an older campaign send', async () => {
  const existingThread = {
    id: 'thread-1',
    account_id: 'account-1',
    mailbox_id: 'mailbox-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    message_count: 1,
    participants: ['porterg@furnaceoutbound.com', 'lead@example.com'],
    category: null,
    category_source: null,
  };
  const job1 = createMessageJob({
    id: 'job-1',
    provider_message_id: '<msg1@furnace.build>',
    sent_at: '2026-07-01T20:00:00.000Z',
  });
  const supabase = new MockSupabase([
    { data: [] }, // dup check
    { data: [job1] }, // match job1 via In-Reply-To
    { data: [existingThread] }, // getOrCreateThread by message_job_id
    // backfill with reply cutoff:
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<msg1@furnace.build>',
          sent_at: '2026-07-01T20:00:00.000Z',
          created_at: '2026-07-01T20:00:00.000Z',
          message_data: { subject: 'First' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
        {
          id: 'job-2',
          provider_message_id: '<msg2@furnace.build>',
          sent_at: '2026-07-08T18:00:00.000Z',
          created_at: '2026-07-08T18:00:00.000Z',
          message_data: { subject: 'Follow-up' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    {
      data: [
        {
          message_job_id: 'job-1',
          event_data: { sent_subject: 'First', sent_body_html: 'a', sent_body_text: 'a' },
        },
        {
          message_job_id: 'job-2',
          event_data: { sent_subject: 'Follow-up', sent_body_html: 'b', sent_body_text: 'b' },
        },
      ],
    },
    { data: [{ message_job_id: 'job-1' }] }, // job-1 already present
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null }, // insert job-2
    { count: 2, error: null },
    { data: null, error: null }, // thread message_count update from backfill
    { data: { id: 'email-message-reply', received_at: '2026-07-15T09:38:24.000Z' }, error: null },
    { count: 3, error: null },
    { data: null, error: null }, // thread update after reply
    { data: [], error: null }, // nodes (no categorizer)
    { data: null, error: null }, // enrollments stop
    { data: 0, error: null }, // cancel_held_jobs
    { data: true, error: null }, // record_replied
    { data: { id: 'notification-event-1' }, error: null },
    { data: { id: 'webhook-event-1' }, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);
  const handled = await manager.handleReply(
    createMailbox(),
    createProcessedMessage({
      messageId: '<reply@example.com>',
      inReplyTo: '<msg1@furnace.build>',
      date: new Date('2026-07-15T09:38:24.000Z'),
    })
  );

  assert.equal(handled, true);

  const backfillJobsQuery = supabase.calls.find(
    (c): c is QueryCall =>
      (c as QueryCall).kind === 'query' &&
      (c as QueryCall).table === 'message_jobs' &&
      (c as QueryCall).filters.some((f) => f.op === 'lte' && f.column === 'sent_at')
  );
  assert.ok(backfillJobsQuery);
  assert.deepEqual(
    backfillJobsQuery.filters.find((f) => f.op === 'lte' && f.column === 'sent_at'),
    { op: 'lte', column: 'sent_at', value: '2026-07-15T09:38:24.000Z' }
  );

  const sentInserts = supabase.calls.filter(
    (c): c is QueryCall =>
      (c as QueryCall).kind === 'query' &&
      (c as QueryCall).table === 'email_messages' &&
      (c as QueryCall).insertPayloads.some(
        (p) => (p as any)?.direction === 'sent' && (p as any)?.message_job_id === 'job-2'
      )
  );
  assert.equal(sentInserts.length, 1);
});

test('handleReply external In-Reply-To still backfills later sends via reply cutoff', async () => {
  const job1 = createMessageJob({
    id: 'job-1',
    provider_message_id: '<msg1@furnace.build>',
    sent_at: '2026-07-01T20:00:00.000Z',
  });
  const supabase = new MockSupabase([
    { data: [] }, // dup check
    { data: [] }, // Outlook IRT — no job
    { data: [job1] }, // References msg1 match
    { data: [] }, // getOrCreateThread: no thread by message_job_id
    { data: [] }, // getOrCreateThread: no campaign+lead thread
    { data: null, error: null }, // firstSentEvent
    {
      data: {
        id: 'thread-new',
        account_id: 'account-1',
        campaign_id: 'campaign-1',
        lead_id: 'lead-1',
        message_job_id: 'job-1',
        participants: [],
        message_count: 1,
      },
      error: null,
    }, // create thread
    // backfill all 3 under reply cutoff
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<msg1@furnace.build>',
          sent_at: '2026-07-01T20:00:00.000Z',
          created_at: '2026-07-01T20:00:00.000Z',
          message_data: { subject: 'First' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
        {
          id: 'job-2',
          provider_message_id: '<msg2@furnace.build>',
          sent_at: '2026-07-08T18:00:00.000Z',
          created_at: '2026-07-08T18:00:00.000Z',
          message_data: { subject: 'Second' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
        {
          id: 'job-3',
          provider_message_id: '<msg3@furnace.build>',
          sent_at: '2026-07-13T19:00:00.000Z',
          created_at: '2026-07-13T19:00:00.000Z',
          message_data: { subject: 'Third' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    {
      data: [
        {
          message_job_id: 'job-1',
          event_data: { sent_subject: 'First', sent_body_html: 'a', sent_body_text: 'a' },
        },
        {
          message_job_id: 'job-2',
          event_data: { sent_subject: 'Second', sent_body_html: 'b', sent_body_text: 'b' },
        },
        {
          message_job_id: 'job-3',
          event_data: { sent_subject: 'Third', sent_body_html: 'c', sent_body_text: 'c' },
        },
      ],
    },
    { data: [] },
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
    { count: 3, error: null },
    { data: null, error: null },
    { data: { id: 'email-message-reply', received_at: '2026-07-15T09:38:24.000Z' }, error: null },
    { count: 4, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: null, error: null },
    { data: 0, error: null },
    { data: true, error: null },
    { data: { id: 'notification-event-1' }, error: null },
    { data: { id: 'webhook-event-1' }, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);
  const handled = await manager.handleReply(
    createMailbox(),
    createProcessedMessage({
      messageId: '<paul-reply@outlook.com>',
      inReplyTo: '<PASP264MB6875@outlook.com>',
      references: '<msg1@furnace.build> <msg3@furnace.build> <PASP264MB6875@outlook.com>',
      from: { address: 'p.cohen@imcas.com', name: 'Paul' },
      date: new Date('2026-07-15T09:38:24.000Z'),
    })
  );

  assert.equal(handled, true);

  const sentJobIds = supabase.calls
    .filter(
      (c): c is QueryCall =>
        (c as QueryCall).kind === 'query' &&
        (c as QueryCall).table === 'email_messages' &&
        (c as QueryCall).insertPayloads.some((p) => (p as any)?.direction === 'sent')
    )
    .flatMap((c) => c.insertPayloads.map((p) => (p as any).message_job_id));
  assert.deepEqual(sentJobIds, ['job-1', 'job-2', 'job-3']);
});

test('getOrCreateThread re-backfills missing follow-ups on an existing sticky thread', async () => {
  const existingThread = {
    id: 'thread-1',
    account_id: 'account-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    message_job_id: 'job-1',
  };
  const supabase = new MockSupabase([
    { data: [existingThread] },
    {
      data: [
        {
          id: 'job-1',
          provider_message_id: '<msg1@furnace.build>',
          sent_at: '2026-07-01T20:00:00.000Z',
          created_at: '2026-07-01T20:00:00.000Z',
          message_data: { subject: 'First' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
        {
          id: 'job-2',
          provider_message_id: '<msg2@furnace.build>',
          sent_at: '2026-07-08T18:00:00.000Z',
          created_at: '2026-07-08T18:00:00.000Z',
          message_data: { subject: 'Follow-up' },
          mailbox_id: 'mailbox-1',
          lead_id: 'lead-1',
        },
      ],
    },
    {
      data: [
        {
          message_job_id: 'job-2',
          event_data: { sent_subject: 'Follow-up', sent_body_html: 'b', sent_body_text: 'b' },
        },
      ],
    },
    { data: [{ message_job_id: 'job-1' }] },
    { data: { email: 'lead@example.com', name: 'Lead' }, error: null },
    { data: null, error: null },
    { count: 2, error: null },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);
  const thread = await (manager as any).getOrCreateThread(
    createMessageJob({ id: 'job-1', provider_message_id: '<msg1@furnace.build>' }),
    createMailbox(),
    '2026-07-15T09:38:24.000Z'
  );

  assert.equal(thread.id, 'thread-1');
  const insertCall = supabase.calls.find(
    (c): c is QueryCall =>
      (c as QueryCall).kind === 'query' &&
      (c as QueryCall).table === 'email_messages' &&
      (c as QueryCall).insertPayloads.some((p) => (p as any)?.message_job_id === 'job-2')
  );
  assert.ok(insertCall);
  assert.equal((insertCall.insertPayloads[0] as any).subject, 'Follow-up');
});

test('handleBounce returns early when bounce already processed (messageId idempotency)', async () => {
  const supabase = new MockSupabase([{ data: { id: 'existing-bounce-event' } }]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({ messageId: '<same-bounce@mail>' });

  await manager.handleBounce(mailbox, message);

  assert.equal(supabase.calls.length, 1);
  const ev = supabase.calls[0] as QueryCall;
  assert.equal(ev.table, 'events');
  assert.ok(ev.filters.some((f) => f.op === 'filter:cs'));
});

test('handleBounce returns early when bounce already processed (uid idempotency)', async () => {
  const supabase = new MockSupabase([{ data: { id: 'existing-bounce-by-uid' } }]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({ messageId: null, uid: 9999 });

  await manager.handleBounce(mailbox, message);

  assert.equal(supabase.calls.length, 1);
  const ev = supabase.calls[0] as QueryCall;
  assert.equal(ev.table, 'events');
  const uidFilter = ev.filters.find(
    (f) => f.op === 'filter:cs' && f.value && typeof f.value === 'object' && 'bounce_uid' in (f.value as object)
  );
  assert.ok(uidFilter);
});

test('handleBounce does nothing when no recent sent message_jobs', async () => {
  const supabase = new MockSupabase([{ data: null }, { data: [] }]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    messageId: '<bounce@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 failed for lead@example.com',
  });

  await manager.handleBounce(mailbox, message);

  assert.equal(supabase.calls.length, 2);
  assert.equal((supabase.calls[1] as QueryCall).table, 'message_jobs');
  assert.equal(supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc').length, 0);
});

test('handleBounce unmatched does not call RPC, accounts, block_list, or enrollments', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-1',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-1',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T01:00:00.000Z',
        },
      ],
    },
    { data: [{ id: 'lead-1', email: 'our-lead@example.com' }] },
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    messageId: '<bounce@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText:
      '550 error. Message could not be delivered to external-warmup@other-domain.com',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);

  assert.equal(supabase.calls.length, 3);
  const tables = supabase.calls.map((c) => (c as QueryCall).table);
  assert.deepEqual(tables, ['events', 'message_jobs', 'leads']);
  assert.equal(supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc').length, 0);
});

test('handleBounce matched hard bounce calls record_bounced_event_and_increment, block_list, and stops enrollment', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-1',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-1',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T01:00:00.000Z',
        },
      ],
    },
    { data: [{ id: 'lead-1', email: 'matched-lead@example.com' }] },
    { data: { suppress_bounced_emails: true } },
    { data: true, error: null }, // rpc record_bounced_event_and_increment
    { data: null, error: null }, // block_list upsert
    { data: { id: 'webhook-event-1' }, error: null }, // webhook_events insert
    { data: null, error: null }, // enrollments stop
    { data: 0, error: null }, // rpc cancel_held_jobs_for_enrollment
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    messageId: '<bounce-hard@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 5.1.1 User unknown matched-lead@example.com',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);

  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    ['record_bounced_event_and_increment', 'cancel_held_jobs_for_enrollment'],
  );
  assert.equal(rpcCalls[0].args.p_campaign_id, 'campaign-1');
  assert.equal(rpcCalls[0].args.p_message_job_id, 'job-1');
  assert.equal(rpcCalls[1].args.p_enrollment_id, 'enrollment-1');

  const blockCall = supabase.calls.find((c) => (c as QueryCall).table === 'block_list') as QueryCall;
  assert.ok(blockCall);
  assert.equal(blockCall.insertPayloads.length, 1);

  const enrollCalls = supabase.calls.filter((c) => (c as QueryCall).table === 'enrollments') as QueryCall[];
  assert.equal(enrollCalls.length, 1);
  assert.match(JSON.stringify(enrollCalls[0].insertPayloads[0]), /"stopped_reason":"bounced"/);
});

test('autoBlockUnsubscribe auto-blocks only the matched sender and does not stop enrollments', async () => {
  const supabase = new MockSupabase([
    {
      data: [
        {
          id: 'job-1',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-1',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T01:00:00.000Z',
        },
        {
          id: 'job-2',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-2',
          lead_id: 'lead-2',
          sent_at: '2026-04-05T00:00:00.000Z',
        },
      ],
    },
    {
      data: [
        { id: 'lead-1', email: 'matched-lead@example.com' },
        { id: 'lead-2', email: 'other-lead@example.com' },
      ],
    },
    { data: null, error: null },
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    from: { address: 'matched-lead@example.com', name: 'Matched Lead' },
    subject: 'unsubscribe',
    bodyText: 'Please unsubscribe me',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.autoBlockUnsubscribe(mailbox, message);

  const blockCall = supabase.calls.find((c) => (c as QueryCall).table === 'block_list') as QueryCall | undefined;
  assert.ok(blockCall);
  assert.equal(blockCall.insertPayloads.length, 1);
  assert.match(JSON.stringify(blockCall.insertPayloads[0]), /"value":"matched-lead@example.com"/);
  assert.match(JSON.stringify(blockCall.insertPayloads[0]), /"reason":"unsubscribed"/);
  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'enrollments'));
});

test('handleBounce matched soft bounce does not upsert block_list', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-soft',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-soft',
          lead_id: 'lead-soft',
          sent_at: '2026-04-05T01:00:00.000Z',
        },
      ],
    },
    { data: [{ id: 'lead-soft', email: 'soft-lead@example.com' }] },
    { data: { suppress_bounced_emails: true } },
    { data: true, error: null }, // rpc record_bounced_event_and_increment
    { data: { id: 'webhook-event-soft' }, error: null }, // webhook_events insert
    { data: null, error: null }, // enrollments stop
    { data: 0, error: null }, // rpc cancel_held_jobs_for_enrollment
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    messageId: '<bounce-soft@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '450 4.2.2 soft-lead@example.com try later',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);

  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'block_list'));
  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    ['record_bounced_event_and_increment', 'cancel_held_jobs_for_enrollment'],
  );
});

test('handleBounce chooses one canonical job when multiple matched jobs share an enrollment', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-inbox-reply',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-dup',
          lead_id: 'lead-1',
          message_type: 'inbox_reply',
          sent_at: '2026-04-05T02:00:00.000Z',
        },
        {
          id: 'job-campaign',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-dup',
          lead_id: 'lead-1',
          message_type: null,
          sent_at: '2026-04-05T01:00:00.000Z',
        },
      ],
    },
    { data: [{ id: 'lead-1', email: 'dup-lead@example.com' }] },
    { data: { suppress_bounced_emails: false } },
    { data: true, error: null }, // rpc record_bounced (canonical campaign job)
    { data: { id: 'webhook-event-a' }, error: null }, // webhook_events insert
    { data: null, error: null }, // enrollments stop
    { data: 0, error: null }, // rpc cancel_held_jobs_for_enrollment
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    messageId: '<bounce-dup@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 5.1.1 dup-lead@example.com',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);

  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    [
      'record_bounced_event_and_increment',
      'cancel_held_jobs_for_enrollment',
    ],
  );
  assert.equal(rpcCalls[0].args.p_message_job_id, 'job-campaign');
  const enrollCalls = supabase.calls.filter((c) => (c as QueryCall).table === 'enrollments') as QueryCall[];
  assert.equal(enrollCalls.length, 1);
  const webhookCalls = supabase.calls.filter((c) => (c as QueryCall).table === 'webhook_events') as QueryCall[];
  assert.equal(webhookCalls.length, 1);
});

test('handleBounce records one bounced event for the same bounce across repeated processing attempts', async () => {
  const supabase = new StatefulBounceSupabase({
    jobs: [
      {
        id: 'job-campaign',
        campaign_id: 'campaign-1',
        enrollment_id: 'enrollment-dup',
        lead_id: 'lead-1',
        message_type: null,
        sent_at: '2026-04-05T02:00:00.000Z',
      },
      {
        id: 'job-campaign-reply',
        campaign_id: 'campaign-1',
        enrollment_id: 'enrollment-dup',
        lead_id: 'lead-1',
        message_type: 'campaign_priority',
        sent_at: '2026-04-05T01:30:00.000Z',
      },
      {
        id: 'job-inbox-reply',
        campaign_id: 'campaign-1',
        enrollment_id: 'enrollment-dup',
        lead_id: 'lead-1',
        message_type: 'inbox_reply',
        sent_at: '2026-04-05T01:00:00.000Z',
      },
    ],
    leads: [{ id: 'lead-1', email: 'dup-lead@example.com' }],
    suppressBouncedEmails: false,
  });
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    uid: 8465,
    messageId: '<same-bounce@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 5.1.1 dup-lead@example.com',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);
  await manager.handleBounce(mailbox, message);

  const bounceCalls = supabase.calls.filter(
    (c) => (c as RpcCall).kind === 'rpc' && (c as RpcCall).fn === 'record_bounced_event_and_increment'
  ) as RpcCall[];

  assert.equal(
    bounceCalls.length,
    1,
    'the same underlying bounce should only be recorded once even if the mailbox is polled again'
  );
  assert.equal(supabase.bouncedEvents.length, 1);
});

test('handleBounce skips bounce side effects when the bounce RPC reports a duplicate insert', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-1',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-1',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T01:00:00.000Z',
          message_type: null,
        },
      ],
    },
    { data: [{ id: 'lead-1', email: 'duplicate-lead@example.com' }] },
    { data: { suppress_bounced_emails: true } },
    { data: false, error: null }, // rpc record_bounced_event_and_increment
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const message = createProcessedMessage({
    uid: 9988,
    messageId: '<bounce-duplicate@mail>',
    from: { address: 'mailer-daemon@example.com' },
    subject: 'Delivery Status Notification (Failure)',
    bodyText: '550 5.1.1 duplicate-lead@example.com',
    to: [{ address: mailbox.email_address, name: 'Box' }],
  });

  await manager.handleBounce(mailbox, message);

  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'block_list'));
  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'webhook_events'));
  assert.ok(!supabase.calls.some((c) => (c as QueryCall).table === 'enrollments'));
  const rpcCalls = supabase.calls.filter((c) => (c as RpcCall).kind === 'rpc') as RpcCall[];
  assert.deepEqual(
    rpcCalls.map((c) => c.fn),
    ['record_bounced_event_and_increment'],
  );
});
