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

  update(payload: unknown) {
    this.call.insertPayloads.push(payload);
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
