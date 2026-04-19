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
    ...overrides,
  };
}

function createEnrollment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    lead_id: `${id}-lead`,
    current_node_id: nodeId,
    lead: {
      id: `${id}-lead`,
      mailbox_id: 'mailbox-1',
      email: `${id}@example.com`,
      name: `Lead ${id}`,
      first_name: 'Lead',
      last_name: id,
      deleted_at: null,
    },
    ...overrides,
  };
}

test('batchAssignIntervalJobs batches existing job lookup before interval RPC', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] }, // campaigns
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] }, // intervals
    { data: [] }, // blocking intervals
    { data: [{ id: nodeId }] }, // email nodes
    {
      data: [
        createEnrollment('enrollment-existing'),
        createEnrollment('enrollment-new', {
          lead_id: 'lead-2',
          lead: {
            id: 'lead-2',
            mailbox_id: 'mailbox-2',
            email: 'new@example.com',
            name: 'New Lead',
            first_name: 'New',
            last_name: 'Lead',
            deleted_at: null,
          },
        }),
      ],
    }, // enrollments
    {
      data: [{ enrollment_id: 'enrollment-existing', node_id: nodeId }],
    }, // get_existing_message_job_pairs
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
        { mailbox_id: 'mailbox-2', mailbox: { id: 'mailbox-2', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    }, // campaign_mailboxes
    { data: [{ id: nodeId, node_data: { subject: 'Hello' } }] }, // nodes data
    {
      data: [{ jobs_created: 1, interval_id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z' }],
    }, // batch_assign_jobs_to_interval
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  assert.deepEqual(rpcCalls.map((call) => call.fn), [
    'get_existing_message_job_pairs',
    'batch_assign_jobs_to_interval',
  ]);

  assert.deepEqual(rpcCalls[0].args.p_pairs, [
    { enrollment_id: 'enrollment-existing', node_id: nodeId },
    { enrollment_id: 'enrollment-new', node_id: nodeId },
  ]);

  const jobData = rpcCalls[1].args.p_job_data as Array<Record<string, unknown>>;
  assert.equal(jobData.length, 1);
  assert.equal(jobData[0].enrollment_id, 'enrollment-new');
  assert.equal(jobData[0].node_id, nodeId);
  assert.equal(jobData[0].mailbox_id, 'mailbox-2');
});

test('batchAssignIntervalJobs skips batch RPC when all candidates already have jobs', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] },
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] },
    { data: [] },
    { data: [{ id: nodeId }] },
    { data: [createEnrollment('enrollment-existing')] },
    {
      data: [{ enrollment_id: 'enrollment-existing', node_id: nodeId }],
    },
  ]);

  await batchAssignIntervalJobs(supabase as any, 0);

  const rpcCalls = supabase.calls.filter((call): call is RpcCall => call.kind === 'rpc');
  assert.deepEqual(rpcCalls.map((call) => call.fn), ['get_existing_message_job_pairs']);
});

test('batchAssignIntervalJobs preserves round-robin mailbox selection for unassigned leads', async () => {
  const supabase = new MockSupabase([
    { data: [createCampaign()] }, // campaigns
    { data: [{ id: 'interval-1', interval_time: '2026-04-19T14:00:00.000Z', status: 'available' }] }, // intervals
    { data: [] }, // blocking intervals
    { data: [{ id: nodeId }, { id: otherNodeId }] }, // email nodes
    {
      data: [
        createEnrollment('enrollment-unassigned', {
          current_node_id: otherNodeId,
          lead_id: 'lead-unassigned',
          lead: {
            id: 'lead-unassigned',
            mailbox_id: null,
            email: 'unassigned@example.com',
            name: 'Unassigned Lead',
            first_name: 'Unassigned',
            last_name: 'Lead',
            deleted_at: null,
          },
        }),
      ],
    }, // enrollments
    { data: [] }, // get_existing_message_job_pairs
    {
      data: [
        { mailbox_id: 'mailbox-1', mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active', deleted_at: null } },
        { mailbox_id: 'mailbox-2', mailbox: { id: 'mailbox-2', status: 'connected', smtp_status: 'active', deleted_at: null } },
      ],
    }, // campaign_mailboxes for eligibility
    { data: [{ id: otherNodeId, node_data: { subject: 'Hi' } }] }, // nodes data
    {
      data: [
        { mailbox: { id: 'mailbox-1', status: 'connected', smtp_status: 'active' } },
        { mailbox: { id: 'mailbox-2', status: 'connected', smtp_status: 'active' } },
      ],
    }, // selectMailbox campaign_mailboxes
    { data: null, error: null }, // update leads mailbox_id
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

  const leadUpdate = supabase.calls.find(
    (call): call is QueryCall => call.kind === 'query' && call.table === 'leads',
  );
  assert.ok(leadUpdate);
  assert.deepEqual(leadUpdate.updates, [{ mailbox_id: 'mailbox-2' }]);
});
