import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAccountNodeStatsRows } from './account-node-stats-rpc-map';

test('mapAccountNodeStatsRows fills labels and coerces counts', () => {
  const mapped = mapAccountNodeStatsRows([
    {
      campaign_id: 'c1',
      campaign_name: null,
      node_id: 'n1',
      flow_node_id: 'email-1',
      node_label: '  ',
      sent_count: '10',
      replied_count: null,
      positive_reply_count: 2,
      bounce_count: 1,
    },
  ]);
  assert.deepEqual(mapped, [
    {
      campaignId: 'c1',
      campaignName: 'Campaign',
      nodeId: 'n1',
      flowNodeId: 'email-1',
      nodeLabel: 'Email step',
      sent: 10,
      replied: 0,
      positiveReply: 2,
      bounced: 1,
    },
  ]);
});
