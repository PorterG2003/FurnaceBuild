import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFlow } from './flow-evaluation.js';
import type { Enrollment } from './types.js';

const enrollment: Enrollment = {
  id: 'ef61bcab-3161-4dc3-afbf-5b532ffc026a',
  campaign_id: 'e17a1b0e-5157-4e6d-8b8d-1e659c1822c5',
  lead_id: '11111111-1111-1111-1111-111111111111',
  current_node_id: '5c94680f-ae44-4910-bfc1-515b420ffa99',
  state: 'active',
  next_run_at: null,
  flow_position: {},
  created_at: '2026-04-16T00:00:00.000Z',
  updated_at: '2026-04-16T00:00:00.000Z',
};

function createSupabaseForCurrentNode(result: { data: any; error: { message: string } | null }) {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => result,
  };

  return {
    from(table: string) {
      assert.equal(table, 'nodes');
      return query;
    },
  };
}

function createSupabaseForEmailNode(messageJob: {
  status: 'queued' | 'reserved' | 'sending' | 'sent' | 'deferred' | 'failed' | 'blocked' | 'cancelled';
  sent_at: string | null;
}) {
  return createSupabaseForEmailNodeQuery({
    messageJobs: [
      {
        id: '62dd8162-0853-4574-b9da-34f6634d74bf',
        sent_at: messageJob.sent_at,
        status: messageJob.status,
      },
    ],
  });
}

function createSupabaseForEmailNodeQuery(options: {
  messageJobs?: Array<{
    id: string;
    sent_at: string | null;
    status: 'queued' | 'reserved' | 'sending' | 'sent' | 'deferred' | 'failed' | 'blocked' | 'cancelled';
  }>;
  messageJobsError?: { message: string } | null;
  orderCalls?: Array<{ column: string; options?: Record<string, unknown> }>;
}) {
  const currentNode = {
    id: enrollment.current_node_id,
    campaign_id: enrollment.campaign_id,
    flow_node_id: 'email-1',
    node_type: 'email',
    node_data: {},
    deleted_at: null,
  };

  const nextNode = {
    id: 'a901edbf-bdfd-4cad-90ab-434a946bf97c',
    campaign_id: enrollment.campaign_id,
    flow_node_id: 'wait-1',
    node_type: 'wait',
    node_data: {},
    deleted_at: null,
  };

  class Query {
    private readonly filters: Array<{ type: string; column: string; value: unknown }> = [];

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ type: 'eq', column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ type: 'is', column, value });
      return this;
    }

    in(column: string, value: unknown) {
      this.filters.push({ type: 'in', column, value });
      return this;
    }

    order(column: string, orderOptions?: Record<string, unknown>) {
      options.orderCalls?.push({ column, options: orderOptions });
      return this;
    }

    limit() {
      return this;
    }

    async maybeSingle() {
      assert.equal(this.table, 'nodes');
      return { data: currentNode, error: null };
    }

    then(resolve: (value: any) => any, reject?: (reason: unknown) => any) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }

    private execute() {
      if (this.table === 'message_jobs') {
        return {
          data: options.messageJobs ?? [],
          error: options.messageJobsError ?? null,
        };
      }

      if (
        this.table === 'nodes' &&
        this.filters.some((filter) => filter.type === 'in' && filter.column === 'flow_node_id')
      ) {
        return { data: [nextNode], error: null };
      }

      throw new Error(`Unexpected query for table ${this.table}`);
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

test('evaluateFlow defers when current-node lookup hits transient Supabase 502', async () => {
  const supabase = createSupabaseForCurrentNode({
    data: null,
    error: {
      message:
        'Transient HTTP 502 from Supabase (Cloudflare could not get a valid response from origin). Not a bug in our query or scheduler logic.',
    },
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    evaluationFailed: true,
    evaluationError:
      'Transient HTTP 502 from Supabase (Cloudflare could not get a valid response from origin). Not a bug in our query or scheduler logic.',
  });
});

test('evaluateFlow preserves retryable details from structured Supabase errors', async () => {
  const supabase = createSupabaseForCurrentNode({
    data: null,
    error: {
      message: 'Failed to load current node',
      details: 'canceling statement due to statement timeout',
    },
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    evaluationFailed: true,
    evaluationError:
      'Failed to load current node | canceling statement due to statement timeout',
  });
});

test('evaluateFlow still throws when the current node row is truly missing', async () => {
  const supabase = createSupabaseForCurrentNode({
    data: null,
    error: null,
  });

  await assert.rejects(
    evaluateFlow(enrollment, enrollment.campaign_id, { edges: [] }, supabase as any),
    /Current node .* not found/
  );
});

test('evaluateFlow waits on queued email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'queued',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    waitingForEmail: true,
  });
});

test('evaluateFlow waits on reserved email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'reserved',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    waitingForEmail: true,
  });
});

test('evaluateFlow waits on sending email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'sending',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    waitingForEmail: true,
  });
});

test('evaluateFlow stops enrollments on cancelled email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'cancelled',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.stopEnrollment, true);
  assert.equal(result.waitingForEmail, undefined);
});

test('evaluateFlow defers when message job lookup errors', async () => {
  const supabase = createSupabaseForEmailNodeQuery({
    messageJobsError: { message: 'temporary lookup failure' },
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.deepEqual(result, {
    nodes: [],
    evaluationFailed: true,
    evaluationError: 'temporary lookup failure',
  });
});

test('evaluateFlow returns current email node when no message job exists yet', async () => {
  const supabase = createSupabaseForEmailNodeQuery({
    messageJobs: [],
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.waitingForEmail, undefined);
  assert.deepEqual(result.nodes.map((node) => node.id), [enrollment.current_node_id!]);
});

test('evaluateFlow returns current email node when the latest attempt is deferred', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'deferred',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.waitingForEmail, undefined);
  assert.deepEqual(result.nodes.map((node) => node.id), [enrollment.current_node_id!]);
});

test('evaluateFlow stops enrollments on blocked email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'blocked',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.stopEnrollment, true);
  assert.equal(result.waitingForEmail, undefined);
});

test('evaluateFlow advances after sent email jobs', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'sent',
    sent_at: '2026-04-17T00:00:00.000Z',
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.waitingForEmail, undefined);
  assert.deepEqual(result.nodes.map((node) => node.id), ['a901edbf-bdfd-4cad-90ab-434a946bf97c']);
});

test('evaluateFlow advances when sent status is present without sent_at', async () => {
  const supabase = createSupabaseForEmailNode({
    status: 'sent',
    sent_at: null,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.waitingForEmail, undefined);
  assert.deepEqual(result.nodes.map((node) => node.id), ['a901edbf-bdfd-4cad-90ab-434a946bf97c']);
});

test('evaluateFlow uses newest-first ordering for multiple message jobs', async () => {
  const orderCalls: Array<{ column: string; options?: Record<string, unknown> }> = [];
  const supabase = createSupabaseForEmailNodeQuery({
    messageJobs: [
      {
        id: 'newest-job',
        sent_at: null,
        status: 'cancelled',
      },
      {
        id: 'older-job',
        sent_at: '2026-04-17T00:00:00.000Z',
        status: 'sent',
      },
    ],
    orderCalls,
  });

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any
  );

  assert.equal(result.stopEnrollment, true);
  assert.deepEqual(orderCalls, [
    { column: 'created_at', options: { ascending: false } },
  ]);
});

test('evaluateFlow uses preloaded nodes and message jobs without extra reads', async () => {
  const currentNode = {
    id: enrollment.current_node_id!,
    campaign_id: enrollment.campaign_id,
    flow_node_id: 'email-1',
    node_type: 'email',
    node_data: {},
    deleted_at: null,
  };
  const nextNode = {
    id: 'a901edbf-bdfd-4cad-90ab-434a946bf97c',
    campaign_id: enrollment.campaign_id,
    flow_node_id: 'wait-1',
    node_type: 'wait',
    node_data: {},
    deleted_at: null,
  };

  const supabase = {
    from() {
      throw new Error('evaluateFlow should not query Supabase when shared context is provided');
    },
  };

  const result = await evaluateFlow(
    enrollment,
    enrollment.campaign_id,
    { edges: [{ source: 'email-1', target: 'wait-1' }] },
    supabase as any,
    {
      nodesById: new Map([
        [currentNode.id, currentNode],
        [nextNode.id, nextNode],
      ]),
      nodesByFlowNodeId: new Map([
        [currentNode.flow_node_id, currentNode],
        [nextNode.flow_node_id, nextNode],
      ]),
      latestMessageJobByPair: new Map([
        [
          `${enrollment.id}:${currentNode.id}`,
          {
            id: 'job-1',
            enrollment_id: enrollment.id,
            node_id: currentNode.id,
            sent_at: '2026-04-17T00:00:00.000Z',
            status: 'sent',
          },
        ],
      ]),
    },
  );

  assert.equal(result.waitingForEmail, undefined);
  assert.deepEqual(result.nodes.map((node) => node.id), ['a901edbf-bdfd-4cad-90ab-434a946bf97c']);
});
