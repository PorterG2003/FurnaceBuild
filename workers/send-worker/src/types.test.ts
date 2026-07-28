import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCampaignMessageJob,
  isPacedCampaignMessageJob,
  isPriorityCampaignJob,
  type MessageType,
} from './types.js';

const TYPES: Array<MessageType | null> = [
  null,
  'campaign',
  'campaign_priority',
  'campaign_reply',
  'inbox_reply',
  'inbox_forward',
];

test('isCampaignMessageJob / isPacedCampaignMessageJob / isPriorityCampaignJob matrix', () => {
  const expected: Record<
    string,
    { outbound: boolean; paced: boolean; priority: boolean }
  > = {
    null: { outbound: true, paced: true, priority: false },
    campaign: { outbound: true, paced: true, priority: false },
    campaign_priority: { outbound: true, paced: false, priority: true },
    campaign_reply: { outbound: true, paced: false, priority: true },
    inbox_reply: { outbound: false, paced: false, priority: false },
    inbox_forward: { outbound: false, paced: false, priority: false },
  };

  for (const t of TYPES) {
    const key = t === null ? 'null' : t;
    const job = { message_type: t };
    assert.equal(isCampaignMessageJob(job), expected[key]!.outbound, `outbound ${key}`);
    assert.equal(isPacedCampaignMessageJob(job), expected[key]!.paced, `paced ${key}`);
    assert.equal(isPriorityCampaignJob(job), expected[key]!.priority, `priority ${key}`);
  }
});
