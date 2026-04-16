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
