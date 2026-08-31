import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulerWorker } from './worker.js';
import type { Enrollment } from './types.js';
import {
  GET_LATEST_MESSAGE_JOBS_FOR_PAIRS_RPC,
  LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE,
} from './latestMessageJobLookup.js';

function toLatestJobRow(pair: { enrollment_id: string; node_id: string }) {
  return {
    id: `job-${pair.enrollment_id}`,
    enrollment_id: pair.enrollment_id,
    node_id: pair.node_id,
    sent_at: null,
    status: 'queued',
    status_reason: null,
    error_message: null,
    created_at: '2026-04-17T00:00:00.000Z',
  };
}

function createWorker() {
  return new SchedulerWorker({
    supabase: {
      rpc: async () => ({ data: 0, error: null }),
    } as any,
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
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

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

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    const response = this.responses.shift();
    if (!response) {
      throw new Error(`No mock response queued for rpc ${fn}`);
    }
    return Promise.resolve(response);
  }
}

class MockRpcSupabase {
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly responses: Array<{ data?: unknown; error?: { message: string } | null }> = []
  ) {}

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    const response = this.responses.shift() ?? { data: null, error: null };
    return Promise.resolve(response);
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

test('SchedulerWorker.stop clears background timers', async () => {
  const worker = createWorker();

  const timerHandles = [
    { id: 'interval-maintenance' },
    { id: 'stale-lock-cleanup' },
    { id: 'batch-interval-assignment' },
    { id: 'ooo-resume' },
    { id: 'campaign-schedule' },
    { id: 'stale-reserved-reclaim' },
    { id: 'self-recovery-audit' },
    { id: 'categorizer-sweep' },
  ];
  (worker as any).intervalMaintenanceTimer = timerHandles[0];
  (worker as any).staleLockCleanupTimer = timerHandles[1];
  (worker as any).batchIntervalAssignmentTimer = timerHandles[2];
  (worker as any).oooResumeTimer = timerHandles[3];
  (worker as any).campaignScheduleTimer = timerHandles[4];
  (worker as any).staleReservedReclaimTimer = timerHandles[5];
  (worker as any).selfRecoveryAuditTimer = timerHandles[6];
  (worker as any).categorizerSweepTimer = timerHandles[7];

  const originalClearInterval = global.clearInterval;
  const cleared: unknown[] = [];
  global.clearInterval = ((handle?: unknown) => {
    cleared.push(handle);
  }) as typeof clearInterval;

  try {
    await worker.stop();
  } finally {
    global.clearInterval = originalClearInterval;
  }

  assert.deepEqual(cleared, timerHandles);
  assert.equal((worker as any).running, false);
});

test('SchedulerWorker.stop drains active batch before resolving', async () => {
  const worker = createWorker();
  let batchFinished = false;
  let resolveBatch!: () => void;
  const batch = new Promise<void>((resolve) => {
    resolveBatch = () => {
      batchFinished = true;
      resolve();
    };
  });
  (worker as any).activeBatch = batch;

  const stopPromise = worker.stop();
  assert.equal(batchFinished, false);
  resolveBatch();
  await stopPromise;
  assert.equal(batchFinished, true);
});

test('SchedulerWorker.stop wakes interruptible sleep without new claims', async () => {
  let pollCount = 0;
  const worker = new SchedulerWorker({
    supabase: {} as any,
    databaseClient: {
      async poll() {
        pollCount += 1;
        return [];
      },
      getPollInterval() {
        return 60_000;
      },
      getBatchSize() {
        return 100;
      },
    } as any,
  });

  const startPromise = worker.start();
  await new Promise((r) => setTimeout(r, 20));
  const pollsBeforeStop = pollCount;
  await worker.stop();
  await startPromise;
  assert.ok(pollsBeforeStop >= 1);
  assert.equal(pollCount, pollsBeforeStop);
});

test('SchedulerWorker stale reserved reclaim timer calls reclaim rpc', async () => {
  const worker = new SchedulerWorker({
    supabase: new MockRpcSupabase([{ data: [{ message_job_id: 'job-1' }], error: null }]) as any,
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
  (worker as any).running = true;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let intervalCallback: (() => void) | undefined;

  global.setInterval = ((callback: (...args: any[]) => void) => {
    intervalCallback = callback as () => void;
    return { id: 'timer-reclaim' } as any;
  }) as typeof setInterval;
  global.clearInterval = (() => {}) as typeof clearInterval;

  try {
    (worker as any).startStaleReservedReclaim();
    assert.ok(intervalCallback);
    intervalCallback();
    await Promise.resolve();
    await Promise.resolve();

    const rpcCalls = ((worker as any).supabase as MockRpcSupabase).rpcCalls;
    assert.deepEqual(rpcCalls, [
      {
        fn: 'reclaim_stale_campaign_message_jobs',
        args: {
          p_batch_size: 50,
          p_rearm_delay_seconds: 60,
          p_reserved_stale_minutes: 5,
        },
      },
    ]);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('SchedulerWorker self recovery audit calls stale sending finalize and health rpc', async () => {
  const worker = new SchedulerWorker({
    supabase: new MockRpcSupabase([
      { data: [{ message_job_id: 'sending-1' }], error: null },
      {
        data: [
          {
            retryable_stopped_count: 2,
            stale_reserved_count: 3,
            stale_sending_count: 1,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            orphaned_held_jobs: 0,
            stale_parked_enrollments: 0,
          },
        ],
        error: null,
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
  (worker as any).running = true;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let intervalCallback: (() => void) | undefined;

  global.setInterval = ((callback: (...args: any[]) => void) => {
    intervalCallback = callback as () => void;
    return { id: 'timer-audit' } as any;
  }) as typeof setInterval;
  global.clearInterval = (() => {}) as typeof clearInterval;

  try {
    (worker as any).startSelfRecoveryAudit();
    assert.ok(intervalCallback);
    intervalCallback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const rpcCalls = ((worker as any).supabase as MockRpcSupabase).rpcCalls;
    assert.deepEqual(rpcCalls, [
      {
        fn: 'finalize_stale_sending_campaign_message_jobs',
        args: {
          p_batch_size: 20,
          p_stale_minutes: 30,
        },
      },
      {
        fn: 'get_job_self_recovery_health',
        args: {
          p_reserved_stale_minutes: 5,
          p_sending_stale_minutes: 30,
        },
      },
      {
        fn: 'get_categorizer_health',
        args: undefined,
      },
    ]);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
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
          {
            id: 'node-wait',
            campaign_id: 'campaign-1',
            flow_node_id: 'wait-1',
            node_type: 'wait',
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
    {
      id: 'enrollment-3',
      campaign_id: 'campaign-1',
      lead_id: 'lead-3',
      current_node_id: 'node-wait',
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

  const supabase = (worker as any).supabase as MockSupabase;
  assert.deepEqual(
    supabase.calls.map((call) => call.table),
    ['campaigns', 'nodes'],
  );
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0].fn, GET_LATEST_MESSAGE_JOBS_FOR_PAIRS_RPC);
  assert.deepEqual(supabase.rpcCalls[0].args.p_pairs, [
    { enrollment_id: 'enrollment-1', node_id: 'node-email' },
  ]);
});

test('SchedulerWorker throws when latest message-job pair RPC fails', async () => {
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
            jitter_percentage: 10,
            sending_interval_seconds: 60,
            created_at: '2026-04-17T00:00:00.000Z',
            status: 'running',
            deleted_at: null,
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
        data: null,
        error: { message: 'canceling statement due to statement timeout' },
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
  ] as Enrollment[]);

  await assert.rejects(
    () => (worker as any).loadCampaignContexts(grouped),
    (error: unknown) =>
      error instanceof Error ||
      (typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        String((error as { message: unknown }).message).includes('statement timeout')),
  );
});

test('SchedulerWorker chunks latest message-job pairs so none are dropped by the RPC cap', async () => {
  const pairs = Array.from({ length: LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE + 5 }, (_unused, index) => ({
    enrollment_id: `enrollment-${index}`,
    node_id: `node-${index}`,
  }));

  const supabase = new MockSupabase([
    { data: pairs.slice(0, LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE).map(toLatestJobRow) },
    { data: pairs.slice(LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE).map(toLatestJobRow) },
  ]);

  const worker = new SchedulerWorker({
    supabase: supabase as any,
    databaseClient: {
      async poll() {
        return [];
      },
      getPollInterval() {
        return 1000;
      },
      getBatchSize() {
        return pairs.length;
      },
    } as any,
  });

  const latestByPair = await (worker as any).loadLatestMessageJobs(pairs);

  assert.equal(supabase.rpcCalls.length, 2);
  assert.equal(
    supabase.rpcCalls.every((call) => call.fn === GET_LATEST_MESSAGE_JOBS_FOR_PAIRS_RPC),
    true,
  );
  assert.equal(
    (supabase.rpcCalls[0].args.p_pairs as unknown[]).length,
    LATEST_MESSAGE_JOB_PAIR_CHUNK_SIZE,
  );
  assert.equal((supabase.rpcCalls[1].args.p_pairs as unknown[]).length, 5);
  assert.equal(latestByPair.size, pairs.length);
  for (const pair of pairs) {
    assert.equal(
      latestByPair.get(`${pair.enrollment_id}:${pair.node_id}`)?.id,
      `job-${pair.enrollment_id}`,
    );
  }
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
  (worker as any).startOutOfOfficeResumeProcessing = () => {};
  (worker as any).startCampaignScheduleProcessing = () => {};
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

test('processEnrollment defers enrollments when the campaign is outside lifecycle bounds', async () => {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const worker = createWorker();
  (worker as any).supabase = {
    from(table: string) {
      const builder = {
        update(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return this;
        },
        eq() {
          return this;
        },
        then<TResult1 = { data: null; error: null }, TResult2 = never>(
          onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve({ data: null, error: null }).then(
            onfulfilled ?? undefined,
            onrejected ?? undefined,
          );
        },
      };
      return builder;
    },
  };

  const enrollment: Enrollment = {
    id: 'enrollment-1',
    campaign_id: 'campaign-1',
    lead_id: 'lead-1',
    current_node_id: null,
    state: 'active',
    next_run_at: '2026-08-01T00:00:00.000Z',
    flow_position: {},
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };

  const outcome = await (worker as any).processEnrollment(enrollment, {
    campaign: {
      id: 'campaign-1',
      flow_data: { nodes: [], edges: [] },
      schedule: null,
      owner_id: 'owner-1',
      account_id: 'account-1',
      created_at: '2026-08-01T00:00:00.000Z',
      status: 'running',
      deleted_at: null,
      pause_at: '2020-01-01T00:00:00.000Z',
    },
  });

  assert.equal(outcome, 'campaign_paused');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].table, 'enrollments');
  assert.equal(typeof updates[0].payload.next_run_at, 'string');
});
