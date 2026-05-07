import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerWorker } from './worker.js';
import type { Enrollment } from './types.js';

function createWorker() {
  return new SchedulerWorker({
    supabase: {} as any,
    databaseClient: {
      async poll() {
        return [];
      },
      getPollInterval() {
        return 1000;
      },
    } as any,
  });
}

type MockResponse = {
  data?: unknown;
  error?: { message: string } | null;
};

class QueryStub implements PromiseLike<MockResponse> {
  constructor(
    private readonly call: {
      table: string;
      filters: Array<{ op: string; column: string; value: unknown }>;
      orderCalls: Array<{ column: string; options?: Record<string, unknown> }>;
    },
    private readonly response: MockResponse,
  ) {}

  select() {
    return this;
  }

  in(column: string, value: unknown) {
    this.call.filters.push({ op: 'in', column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.call.filters.push({ op: 'is', column, value });
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.call.orderCalls.push({ column, options });
    return this;
  }

  then<TResult1 = MockResponse, TResult2 = never>(
    onfulfilled?: ((value: MockResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class MockSupabase {
  readonly calls: Array<{
    table: string;
    filters: Array<{ op: string; column: string; value: unknown }>;
    orderCalls: Array<{ column: string; options?: Record<string, unknown> }>;
  }> = [];

  constructor(private readonly responses: MockResponse[]) {}

  from(table: string) {
    const response = this.responses.shift();
    if (!response) {
      throw new Error(`No mock response queued for table ${table}`);
    }

    const call = {
      table,
      filters: [],
      orderCalls: [],
    };
    this.calls.push(call);
    return new QueryStub(call, response);
  }
}

test('SchedulerWorker single-flight intervals skip overlapping ticks', async () => {
  const worker = createWorker();
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

test('SchedulerWorker.stop clears background timers', () => {
  const worker = createWorker();

  const timerHandles = [
    { id: 'interval-maintenance' },
    { id: 'stale-lock-cleanup' },
    { id: 'batch-interval-assignment' },
  ];
  (worker as any).intervalMaintenanceTimer = timerHandles[0];
  (worker as any).staleLockCleanupTimer = timerHandles[1];
  (worker as any).batchIntervalAssignmentTimer = timerHandles[2];

  const originalClearInterval = global.clearInterval;
  const cleared: unknown[] = [];
  global.clearInterval = ((handle?: unknown) => {
    cleared.push(handle);
  }) as typeof clearInterval;

  try {
    worker.stop();
  } finally {
    global.clearInterval = originalClearInterval;
  }

  assert.deepEqual(cleared, timerHandles);
});

test('SchedulerWorker batches campaign, node, and message-job preloads per claim batch', async () => {
  const worker = new SchedulerWorker({
    supabase: new MockSupabase([
      {
        data: [
          {
            id: 'campaign-1',
            flow_data: { edges: [] },
            current_flow_version_number: 2,
            schedule: null,
            owner_id: 'owner-1',
            account_id: 'account-1',
            jitter_percentage: null,
            sending_interval_seconds: 60,
            created_at: '2026-04-17T00:00:00.000Z',
            status: 'running',
            deleted_at: null,
            accounts: { jitter_percentage: 17 },
          },
        ],
      },
      {
        data: [
          {
            id: 'node-email',
            campaign_id: 'campaign-1',
            flow_node_id: 'email-1',
            node_type: 'email',
            node_data: {},
            deleted_at: null,
          },
        ],
      },
      {
        data: [
          {
            id: 'job-1',
            enrollment_id: 'enrollment-1',
            node_id: 'node-email',
            sent_at: null,
            status: 'queued',
            created_at: '2026-04-17T00:00:00.000Z',
          },
        ],
      },
    ]) as any,
    databaseClient: {
      async poll() {
        return [];
      },
      getPollInterval() {
        return 1000;
      },
      getBatchSize() {
        return 100;
      },
    } as any,
  });

  const grouped = (worker as any).groupEnrollmentsByCampaign([
    {
      id: 'enrollment-1',
      campaign_id: 'campaign-1',
      lead_id: 'lead-1',
      current_node_id: 'node-email',
      state: 'active',
      next_run_at: null,
      flow_position: {},
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    },
    {
      id: 'enrollment-2',
      campaign_id: 'campaign-1',
      lead_id: 'lead-2',
      current_node_id: null,
      state: 'active',
      next_run_at: null,
      flow_position: {},
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    },
  ] as Enrollment[]);

  const contexts = await (worker as any).loadCampaignContexts(grouped);
  const context = contexts.get('campaign-1');

  assert.ok(context);
  assert.equal(context.jitterPercentage, 17);
  assert.equal(context.nodesById.get('node-email')?.flow_node_id, 'email-1');
  assert.equal(
    context.latestMessageJobByPair.get('enrollment-1:node-email')?.status,
    'queued',
  );

  const supabaseCalls = ((worker as any).supabase as MockSupabase).calls;
  assert.deepEqual(
    supabaseCalls.map((call) => call.table),
    ['campaigns', 'nodes', 'message_jobs'],
  );
});

test('SchedulerWorker shapes load after a full claim batch', async () => {
  const enrollments: Enrollment[] = [
    {
      id: 'enrollment-1',
      campaign_id: 'campaign-1',
      lead_id: 'lead-1',
      current_node_id: null,
      state: 'active',
      next_run_at: null,
      flow_position: {},
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    },
    {
      id: 'enrollment-2',
      campaign_id: 'campaign-1',
      lead_id: 'lead-2',
      current_node_id: null,
      state: 'active',
      next_run_at: null,
      flow_position: {},
      created_at: '2026-04-17T00:00:00.000Z',
      updated_at: '2026-04-17T00:00:00.000Z',
    },
  ];

  let pollCalls = 0;
  const worker = new SchedulerWorker({
    supabase: {} as any,
    databaseClient: {
      async poll() {
        pollCalls += 1;
        return pollCalls === 1 ? enrollments : [];
      },
      getPollInterval() {
        return 1000;
      },
      getBatchSize() {
        return 2;
      },
    } as any,
  });

  const sleeps: number[] = [];
  (worker as any).startIntervalMaintenance = () => {};
  (worker as any).startStaleLockCleanup = () => {};
  (worker as any).startBatchIntervalAssignment = () => {};
  (worker as any).loadCampaignContexts = async () =>
    new Map([
      [
        'campaign-1',
        {
          campaign: {
            id: 'campaign-1',
            flow_data: { edges: [] },
            current_flow_version_number: 1,
            schedule: null,
            owner_id: 'owner-1',
            account_id: 'account-1',
            jitter_percentage: 10,
            sending_interval_seconds: 60,
            created_at: '2026-04-17T00:00:00.000Z',
            status: 'running',
            deleted_at: null,
          },
          jitterPercentage: 10,
          accountMissingConfig: false,
          nodesById: new Map(),
          nodesByFlowNodeId: new Map(),
          latestMessageJobByPair: new Map(),
        },
      ],
    ]);
  (worker as any).processEnrollment = async () => {};
  (worker as any).sleep = async (ms: number) => {
    sleeps.push(ms);
    if (ms === 750) {
      worker.stop();
    }
  };

  await worker.start();

  assert.ok(sleeps.includes(750));
});
