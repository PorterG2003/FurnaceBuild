import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLifecycleSendEligibleCampaign,
  shouldDeferReservedCampaignJob,
} from './campaign-send-eligible.js';

test('send-worker lifecycle eligibility matches start_at <= now < pause_at', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.equal(isLifecycleSendEligibleCampaign({ status: 'running' }, now), true);
  assert.equal(
    isLifecycleSendEligibleCampaign({
      status: 'running',
      pause_at: '2026-09-01T12:00:00.000Z',
    }, now),
    false,
  );
  assert.equal(isLifecycleSendEligibleCampaign({ status: 'scheduled' }, now), false);
});

test('reserved campaign jobs defer when scheduled, paused, or past pause_at', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.equal(shouldDeferReservedCampaignJob({ status: 'running' }, now), false);
  assert.equal(shouldDeferReservedCampaignJob({ status: 'paused' }, now), true);
  assert.equal(shouldDeferReservedCampaignJob({ status: 'scheduled' }, now), true);
  assert.equal(
    shouldDeferReservedCampaignJob({
      status: 'running',
      pause_at: '2026-09-01T12:00:00.000Z',
    }, now),
    true,
  );
  assert.equal(shouldDeferReservedCampaignJob({ status: 'stopped' }, now), false);
});
