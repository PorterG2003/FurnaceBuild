import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCampaignStatsByDayRpcRows } from './campaign-stats-by-day-rpc-map';

test('mapCampaignStatsByDayRpcRows maps stat_date and counts', () => {
  const out = mapCampaignStatsByDayRpcRows([
    {
      stat_date: '2026-05-01',
      sent_count: 10,
      replied_count: 2,
      positive_reply_count: 1,
      bounce_count: 0,
    },
  ]);
  assert.deepEqual(out, [
    { date: '2026-05-01', sent: 10, replied: 2, positiveReply: 1, bounce: 0 },
  ]);
});

test('mapCampaignStatsByDayRpcRows coerces string bigint-style counts', () => {
  const out = mapCampaignStatsByDayRpcRows([
    {
      stat_date: '2026-05-02',
      sent_count: '122',
      replied_count: '3',
      positive_reply_count: '0',
      bounce_count: '1',
    },
  ]);
  assert.deepEqual(out, [
    { date: '2026-05-02', sent: 122, replied: 3, positiveReply: 0, bounce: 1 },
  ]);
});

test('mapCampaignStatsByDayRpcRows normalizes non-ISO stat_date to UTC Y-m-d', () => {
  const out = mapCampaignStatsByDayRpcRows([
    {
      stat_date: '2026-05-03T00:00:00.000Z',
      sent_count: 1,
      replied_count: null,
      positive_reply_count: null,
      bounce_count: null,
    },
  ]);
  assert.equal(out[0]?.date, '2026-05-03');
  assert.equal(out[0]?.sent, 1);
  assert.equal(out[0]?.replied, 0);
  assert.equal(out[0]?.positiveReply, 0);
  assert.equal(out[0]?.bounce, 0);
});
