import test from 'node:test';
import assert from 'node:assert/strict';
import { isLifecycleSendEligibleCampaign } from './campaign-send-eligible.js';

test('lifecycle eligibility is half-open start_at <= now < pause_at and requires running', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.equal(isLifecycleSendEligibleCampaign({ status: 'running' }, now), true);
  assert.equal(
    isLifecycleSendEligibleCampaign({
      status: 'running',
      start_at: '2026-09-01T05:00:00.000Z',
      pause_at: '2026-10-01T05:00:00.000Z',
    }, now),
    true,
  );
  assert.equal(
    isLifecycleSendEligibleCampaign({
      status: 'running',
      start_at: '2026-09-02T05:00:00.000Z',
    }, now),
    false,
  );
  assert.equal(
    isLifecycleSendEligibleCampaign({
      status: 'running',
      pause_at: '2026-09-01T12:00:00.000Z',
    }, now),
    false,
  );
  assert.equal(isLifecycleSendEligibleCampaign({ status: 'scheduled' }, now), false);
  assert.equal(
    isLifecycleSendEligibleCampaign({
      status: 'running',
      deleted_at: now.toISOString(),
    }, now),
    false,
  );
});
