import test from 'node:test';
import assert from 'node:assert/strict';
import { batchAssignIntervalJobs } from './batch-interval-assignment.js';

type Response = {
  data?: unknown;
  error?: { message: string } | null;
};

type QueryCall = {
  kind: 'query';
  table: string;
  filters: Array<{ op: string; column?: string; value?: unknown }>;
  orders: Array<{ column: string; options?: Record<string, unknown> }>;
  limits: number[];
  selects: string[];
  updates: unknown[];
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
    private readonly response: Response,
  ) {}

  select(columns: string) {
    this.call.selects.push(columns);
    return this;
  }

  update(payload: unknown) {
    this.call.updates.push(payload);
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.call.filters.push({ op: 'gt', column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.call.filters.push({ op: 'lt', column, value });
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

  neq(column: string, value: unknown) {
    this.call.filters.push({ op: 'neq', column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.call.filters.push({ op: 'is', column, value });
    return this;
  }

  not(column: string, value: unknown, modifier?: unknown) {
    this.call.filters.push({ op: 'not', column, value: [value, modifier] });
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

  single() {
    this.call.singleMode = 'single';
    return this;
  }

  maybeSingle() {
    this.call.singleMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class MockSupabase {
  readonly calls: Array<QueryCall | RpcCall> = [];

  constructor(private readonly responses: Response[]) {}

  from(table: string) {
    const response = this.responses.shift();
    if (!response) {
      throw new Error(`No mock response queued for table ${table}`);
    }

    const call: QueryCall = {
      kind: 'query',
      table,
      filters: [],
      orders: [],
      limits: [],
      selects: [],
      updates: [],
      singleMode: null,
    };
    this.calls.push(call);
    return new MockQueryBuilder(call, response);
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ kind: 'rpc', fn, args });
    const response = this.responses.shift();
    if (!response) {
      throw new Error(`No mock response queued for rpc ${fn}`);
    }
    return response;
  }
}

const campaignId = 'campaign-1';
const nodeId = 'node-1';
const otherNodeId = 'node-2';

function createCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: campaignId,
    jitter_percentage: 12,
    account_id: 'account-1',
    accounts: { jitter_percentage: 7 },
    status: 'running',
    deleted_at: null,
    start_at: null,
    pause_at: null,
    ...overrides,
  };
}

/** Flat row shape returned by get_ready_interval_enrollments. */
function createReadyEnrollment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    lead_id: `${id}-lead`,
    current_node_id: nodeId,
    next_run_at: '2026-04-19T13:00:00.000Z',
    created_at: '2026-04-19T12:00:00.000Z',
    lead_mailbox_id: 'mailbox-1',
    lead_email: `${id}@example.com`,
    lead_name: `Lead ${id}`,
    lead_first_name: 'Lead',
    lead_last_name: id,
    ...overrides,
  };
}

test('batchAssignIntervalJobs uses ready-enrollments RPC before interval RPC', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] }, // campaigns
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] }, // earliest incomplete interval
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] }, // email nodes (includes node_data)
    {
      // get_ready_interval_enrollments already excludes enrollment-existing
      data: [
        createReadyEnrollment('enrollment-new', {
          lead_id: 'lead-2',
          lead_mailbox_id: 'mailbox-2',
          lead_email: 'new@example.com',
          lead_name: 'New Lead',
          lead_first_name: 'New',
          lead_last_name: 'Lead',
        }),
      ],
    },
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
        { mailbox_id: 'mailbox-2', mailbox: { id: 'mailbox-2', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    }, // campaign_mailboxes
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    }, // batch_assign_jobs_to_interval
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  assert.deepEqual(rpcCalls.map((call) => call.fn), [
    'get_ready_interval_enrollments',
    'batch_assign_jobs_to_interval',
  ]);

  assert.deepEqual(rpcCalls[0].args.p_campaign_id, campaignId);
  assert.deepEqual(rpcCalls[0].args.p_node_ids, [nodeId]);
  assert.ok(typeof rpcCalls[0].args.p_now === 'string');

  const jobData = rpcCalls[1].args.p_job_data as Array<Record<string, unknown>>;
  assert.equal(jobData.length, 1);
  assert.equal(jobData[0].enrollment_id, 'enrollment-new');
  assert.equal(jobData[0].node_id, nodeId);
  assert.equal(jobData[0].mailbox_id, 'mailbox-2');
  assert.equal(rpcCalls[1].args.p_required_mailbox_count, 2);
});

test('batchAssignIntervalJobs skips batch RPC when ready-enrollments RPC returns none', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] },
    { data: [] }, // get_ready_interval_enrollments — all candidates already have jobs
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  assert.deepEqual(rpcCalls.map((call) => call.fn), ['get_ready_interval_enrollments']);
});

test('batchAssignIntervalJobs preserves round-robin mailbox selection for unassigned leads', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] }, // campaigns
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] }, // earliest incomplete interval
    { data: [{ id: nodeId, node_data: { subject: 'Hi' } }, { id: otherNodeId, node_data: { subject: 'Hi' } }] }, // email nodes
    {
      data: [
        createReadyEnrollment('enrollment-unassigned', {
          current_node_id: otherNodeId,
          lead_id: 'lead-unassigned',
          lead_mailbox_id: null,
          lead_email: 'unassigned@example.com',
          lead_name: 'Unassigned Lead',
          lead_first_name: 'Unassigned',
          lead_last_name: 'Lead',
        }),
      ],
    }, // get_ready_interval_enrollments
    { data: [] }, // live campaign jobs by lead
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
        { mailbox_id: 'mailbox-2', mailbox: { id: 'mailbox-2', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    }, // campaign_mailboxes for eligibility
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    }, // batch_assign_jobs_to_interval
  ]);

  await batchAssignIntervalJobs(supabase as any, 1);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  const batchRpc = rpcCalls.find((call) => call.fn === 'batch_assign_jobs_to_interval');
  assert.ok(batchRpc);

  const jobData = batchRpc.args.p_job_data as Array<Record<string, unknown>>;
  assert.equal(jobData.length, 1);
  assert.equal(jobData[0].mailbox_id, 'mailbox-2');
  assert.equal(batchRpc.args.p_required_mailbox_count, 2);

  const mailboxQueries = supabase.calls.filter(
    (call): call is QueryCall =>
      call.kind === 'query' && call.table === 'campaign_mailboxes',
  );
  assert.equal(mailboxQueries.length, 1);
});

test('batchAssignIntervalJobs only keeps one candidate per mailbox for the current interval', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] },
    {
      data: [
        createReadyEnrollment('enrollment-a'),
        createReadyEnrollment('enrollment-b', {
          lead_id: 'lead-b',
          lead_mailbox_id: 'mailbox-1',
          lead_email: 'b@example.com',
          lead_name: 'Lead B',
          lead_first_name: 'Lead',
          lead_last_name: 'B',
        }),
      ],
    },
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    },
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  const batchRpc = rpcCalls.find((call) => call.fn === 'batch_assign_jobs_to_interval');
  assert.ok(batchRpc);

  const jobData = batchRpc.args.p_job_data as Array<Record<string, unknown>>;
  assert.equal(jobData.length, 1);
  assert.equal(jobData[0].mailbox_id, 'mailbox-1');
  assert.equal(batchRpc.args.p_required_mailbox_count, 1);
});

test('batchAssignIntervalJobs reuses live campaign job mailbox before first send', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [{ id: otherNodeId, node_data: { subject: 'Hi' } }] },
    {
      data: [
        createReadyEnrollment('enrollment-live-mailbox', {
          current_node_id: otherNodeId,
          lead_id: 'lead-live',
          next_run_at: '2026-04-19T13:00:00.000Z',
          lead_mailbox_id: null,
          lead_email: 'live@example.com',
          lead_name: 'Live Lead',
          lead_first_name: 'Live',
          lead_last_name: 'Lead',
        }),
      ],
    }, // get_ready_interval_enrollments
    {
      data: [
        {
          id: 'job-live',
          lead_id: 'lead-live',
          mailbox_id: 'mailbox-live',
          created_at: '2026-04-19T12:59:00.000Z',
        },
      ],
    }, // existing live campaign jobs by lead
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    }, // campaign_mailboxes for eligibility
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  const batchRpc = rpcCalls.find((call) => call.fn === 'batch_assign_jobs_to_interval');
  assert.ok(batchRpc);

  const jobData = batchRpc.args.p_job_data as Array<Record<string, unknown>>;
  assert.equal(jobData.length, 1);
  assert.equal(jobData[0].mailbox_id, 'mailbox-live');
});

test('batchAssignIntervalJobs chunks live campaign job mailbox lookup by lead_id for large batches', async () => {
  const enrollmentRows = Array.from({ length: 150 }, (_, i) =>
    createReadyEnrollment(`enrollment-${i}`, {
      lead_id: `lead-${i}`,
      lead_mailbox_id: null,
      lead_email: `user-${i}@example.com`,
      lead_name: `Lead ${i}`,
      lead_first_name: 'Lead',
      lead_last_name: String(i),
    }),
  );

  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] },
    { data: enrollmentRows },
    { data: [] },
    { data: [] },
    {
      data: [
        {
          mailbox_id: 'mailbox-1',
          mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null },
        },
      ],
    },
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const messageJobQueries = supabase.calls.filter(
    (call): call is QueryCall => call.kind === 'query' && call.table === 'message_jobs',
  );
  assert.equal(messageJobQueries.length, 2);
  const leadInFilters = messageJobQueries.map((call) =>
    call.filters.find((f) => f.op === 'in' && f.column === 'lead_id')?.value,
  );
  assert.equal((leadInFilters[0] as unknown[]).length, 100);
  assert.equal((leadInFilters[1] as unknown[]).length, 50);
});

test('batchAssignIntervalJobs does not issue a second nodes query', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] },
    { data: [createReadyEnrollment('enrollment-new')] },
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    },
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const nodesQueries = supabase.calls.filter(
    (call): call is QueryCall => call.kind === 'query' && call.table === 'nodes',
  );
  assert.equal(nodesQueries.length, 1, 'node_data must be reused from the initial email-nodes load');
});

test('batchAssignIntervalJobs skips campaigns outside lifecycle bounds', async () => {
  const supabase = new MockSupabase([
    {
      data: [
        createCampaign({
          pause_at: '2020-01-01T00:00:00.000Z',
          status: 'running',
          deleted_at: null,
        }),
      ],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  assert.deepEqual(rpcCalls, []);
  const intervalQueries = supabase.calls.filter(
    (call): call is QueryCall => call.kind === 'query' && call.table === 'campaign_intervals',
  );
  assert.equal(intervalQueries.length, 0);
});
