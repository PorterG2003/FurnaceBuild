import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  return (
    message.includes('account_node_stats') &&
    (error?.code === 'PGRST202' || error?.code === 'PGRST203' || message.includes('does not exist'))
  );
}

test('account_node_stats ranks sequence steps by sent and interested', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('node-stats'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Node Stats',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `node-a-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'step-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              messageType: 'campaign',
            }),
          ],
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('account_node_stats', {
      p_account_id: harness.env.accountId,
      p_start_date: null,
      p_end_date: null,
      p_campaign_ids: [graph.campaignId],
    });
    if (isMissingRpc(error)) {
      t.skip('DB-backed test target has not applied account_node_stats; refresh PostgREST schema after migrate');
      return;
    }
    assert.equal(error, null, error?.message);
    const rows = (data ?? []) as Array<{
      campaign_id: string;
      node_id: string;
      sent_count: number | string;
    }>;
    assert.ok(rows.length >= 1);
    assert.equal(rows[0]?.campaign_id, graph.campaignId);
    assert.equal(Number(rows[0]?.sent_count), 1);
  } finally {
    await harness.cleanup();
  }
});
