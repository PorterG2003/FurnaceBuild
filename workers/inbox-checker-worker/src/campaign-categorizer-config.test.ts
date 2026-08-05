import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCampaignCategorizerConfig } from './campaign-categorizer-config.js';

function mockNodesQuery(result: { data: unknown; error: { message: string } | null }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    limit: async () => result,
  };
  return {
    from: (table: string) => {
      assert.equal(table, 'nodes');
      return chain;
    },
  };
}

test('loadCampaignCategorizerConfig returns ok with hasCategorizer when a node exists', async () => {
  const supabase = mockNodesQuery({
    data: [{ id: 'n1', node_data: { use_ai: true } }],
    error: null,
  });
  const result = await loadCampaignCategorizerConfig(supabase as any, 'campaign-1');
  assert.deepEqual(result, { status: 'ok', hasCategorizer: true, useAi: true });
});

test('loadCampaignCategorizerConfig returns ok hasCategorizer=false when no node', async () => {
  const supabase = mockNodesQuery({ data: [], error: null });
  const result = await loadCampaignCategorizerConfig(supabase as any, 'campaign-1');
  assert.deepEqual(result, { status: 'ok', hasCategorizer: false, useAi: false });
});

test('loadCampaignCategorizerConfig returns error status on DB failure (never pretend no categorizer)', async () => {
  const supabase = mockNodesQuery({
    data: null,
    error: { message: 'connection reset' },
  });
  const result = await loadCampaignCategorizerConfig(supabase as any, 'campaign-1');
  assert.equal(result.status, 'error');
  if (result.status === 'error') {
    assert.equal(result.error, 'connection reset');
  }
});
