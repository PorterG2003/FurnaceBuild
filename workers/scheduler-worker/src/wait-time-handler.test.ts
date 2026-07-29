import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWaitTimeNode } from './node-handlers/wait-time-handler.js';
import type { Enrollment } from './types.js';

class UpdateQuery {
  constructor(
    private readonly updates: unknown[],
    private readonly filters: Array<{ column: string; value: unknown }>,
  ) {}

  update(payload: unknown) {
    this.updates.push(payload);
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return Promise.resolve({ error: null });
  }
}

class MockSupabase {
  readonly updates: unknown[] = [];
  readonly filters: Array<{ column: string; value: unknown }> = [];

  from(table: string) {
    assert.equal(table, 'enrollments');
    return new UpdateQuery(this.updates, this.filters);
  }
}

const baseEnrollment: Enrollment = {
  id: 'enrollment-1',
  campaign_id: 'campaign-1',
  lead_id: 'lead-1',
  current_node_id: 'node-1',
  state: 'active',
  next_run_at: null,
  flow_position: {},
  created_at: '2026-05-01T10:00:00.000Z',
  updated_at: '2026-05-01T10:00:00.000Z',
};

test('handleWaitTimeNode uses canonical wait_duration_seconds from enrollment updated_at', async () => {
  const supabase = new MockSupabase();

  await handleWaitTimeNode(
    baseEnrollment,
    {
      id: 'wait-node',
      node_data: { wait_duration_seconds: 3600 },
    },
    null,
    3,
    supabase as any,
  );

  assert.equal(supabase.updates.length, 1);
  assert.deepEqual(supabase.filters, [{ column: 'id', value: baseEnrollment.id }]);
  assert.deepEqual(supabase.updates[0], {
    current_node_id: 'wait-node',
    current_flow_version_number: 3,
    next_run_at: '2026-05-01T11:00:00.000Z',
  });
});

test('handleWaitTimeNode converts legacy duration + unit fields', async () => {
  const supabase = new MockSupabase();

  await handleWaitTimeNode(
    baseEnrollment,
    {
      id: 'wait-node',
      node_data: { duration: '2', unit: 'days' },
    },
    null,
    4,
    supabase as any,
  );

  assert.deepEqual(supabase.updates[0], {
    current_node_id: 'wait-node',
    current_flow_version_number: 4,
    next_run_at: '2026-05-03T10:00:00.000Z',
  });
});

test('handleWaitTimeNode applies default 3-day wait for zero or invalid durations', async () => {
  const supabase = new MockSupabase();

  await handleWaitTimeNode(
    baseEnrollment,
    {
      id: 'wait-node',
      node_data: { wait_duration_seconds: 0 },
    },
    null,
    1,
    supabase as any,
  );

  assert.deepEqual(supabase.updates[0], {
    current_node_id: 'wait-node',
    current_flow_version_number: 1,
    next_run_at: '2026-05-04T10:00:00.000Z',
  });
});

test('handleWaitTimeNode clamps under-min waits to 3 minutes', async () => {
  const supabase = new MockSupabase();

  await handleWaitTimeNode(
    baseEnrollment,
    {
      id: 'wait-node',
      node_data: { wait_duration_seconds: 60 },
    },
    null,
    2,
    supabase as any,
  );

  assert.deepEqual(supabase.updates[0], {
    current_node_id: 'wait-node',
    current_flow_version_number: 2,
    next_run_at: '2026-05-01T10:03:00.000Z',
  });
});

test('handleWaitTimeNode falls back to unscheduled base time when schedule calculation throws', async () => {
  const supabase = new MockSupabase();

  await handleWaitTimeNode(
    baseEnrollment,
    {
      id: 'wait-node',
      node_data: { wait_duration_seconds: 1800 },
    },
    { timezone: 'Not/AZone' } as any,
    5,
    supabase as any,
  );

  assert.deepEqual(supabase.updates[0], {
    current_node_id: 'wait-node',
    current_flow_version_number: 5,
    next_run_at: '2026-05-01T10:30:00.000Z',
  });
});
