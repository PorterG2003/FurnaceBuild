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
  ]);
  const manager = new ThreadManager(supabase as any);
  const mailbox = createMailbox();
  const messageJob = createMessageJob();

  const thread = await (manager as any).getOrCreateThread(messageJob, mailbox);

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
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
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
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'record_bounced_event_and_increment');
  assert.equal(rpcCalls[0].args.p_campaign_id, 'campaign-1');
  assert.equal(rpcCalls[0].args.p_message_job_id, 'job-1');

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
    { data: null, error: null },
    { data: null, error: null },
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
  assert.equal(rpcCalls.length, 1);
});

test('handleBounce dedupes enrollment stop when multiple matched jobs share enrollment_id', async () => {
  const supabase = new MockSupabase([
    { data: null },
    {
      data: [
        {
          id: 'job-a',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-dup',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T02:00:00.000Z',
        },
        {
          id: 'job-b',
          campaign_id: 'campaign-1',
          enrollment_id: 'enrollment-dup',
          lead_id: 'lead-1',
          sent_at: '2026-04-05T01:00:00.000Z',
        },
      ],
    },
    { data: [{ id: 'lead-1', email: 'dup-lead@example.com' }] },
    { data: { suppress_bounced_emails: false } },
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
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
  assert.equal(rpcCalls.length, 2);
  const enrollCalls = supabase.calls.filter((c) => (c as QueryCall).table === 'enrollments') as QueryCall[];
  assert.equal(enrollCalls.length, 1);
});
