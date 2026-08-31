import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_SCHEDULE_DEFAULT_POLL_MS,
  CAMPAIGN_SCHEDULE_MAX_BATCHES,
  CAMPAIGN_SCHEDULE_MAX_POLL_MS,
  CAMPAIGN_SCHEDULE_MIN_POLL_MS,
  CAMPAIGN_SCHEDULE_RPC_BATCH_SIZE,
  resolveCampaignSchedulePollIntervalMs,
  runCampaignScheduleTick,
} from './campaign-schedule-tick.js';

test('resolveCampaignSchedulePollIntervalMs uses 60s default when unset or non-numeric', () => {
  assert.equal(resolveCampaignSchedulePollIntervalMs(undefined), CAMPAIGN_SCHEDULE_DEFAULT_POLL_MS);
  assert.equal(resolveCampaignSchedulePollIntervalMs('not-a-number'), CAMPAIGN_SCHEDULE_DEFAULT_POLL_MS);
});

test('resolveCampaignSchedulePollIntervalMs clamps to min 15s and max 30m', () => {
  assert.equal(resolveCampaignSchedulePollIntervalMs('1000'), CAMPAIGN_SCHEDULE_MIN_POLL_MS);
  assert.equal(resolveCampaignSchedulePollIntervalMs('15000'), CAMPAIGN_SCHEDULE_MIN_POLL_MS);
  assert.equal(resolveCampaignSchedulePollIntervalMs(String(30 * 60 * 1000)), CAMPAIGN_SCHEDULE_MAX_POLL_MS);
  assert.equal(resolveCampaignSchedulePollIntervalMs(String(60 * 60 * 1000)), CAMPAIGN_SCHEDULE_MAX_POLL_MS);
});

test('runCampaignScheduleTick returns zero processed for an empty batch', async () => {
  const calls: unknown[] = [];
  const result = await runCampaignScheduleTick({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: 0, error: null };
    },
  } as any);
  assert.deepEqual(result, { processed: 0, batches: 1 });
  assert.deepEqual(calls, [{
    name: 'process_due_campaign_schedule_transitions',
    args: { p_batch_size: CAMPAIGN_SCHEDULE_RPC_BATCH_SIZE },
  }]);
});

test('runCampaignScheduleTick drains full batches then stops on a short batch', async () => {
  const sizes = [50, 50, 12];
  const result = await runCampaignScheduleTick({
    rpc: async () => {
      return { data: sizes.shift() ?? 0, error: null };
    },
  } as any);
  assert.deepEqual(result, { processed: 112, batches: 3 });
});

test('runCampaignScheduleTick caps drain at maxBatches', async () => {
  const result = await runCampaignScheduleTick(
    {
      rpc: async () => ({ data: 50, error: null }),
    } as any,
    { batchSize: 50, maxBatches: 3 },
  );
  assert.deepEqual(result, { processed: 150, batches: CAMPAIGN_SCHEDULE_MAX_BATCHES > 3 ? 3 : 3 });
  assert.equal(result.batches, 3);
});

test('runCampaignScheduleTick recovers by propagating RPC errors', async () => {
  const err = { message: 'boom' };
  await assert.rejects(
    async () =>
      runCampaignScheduleTick({
        rpc: async () => ({ data: null, error: err }),
      } as any),
    (thrown: unknown) => thrown === err,
  );
});

test('runCampaignScheduleTick treats non-numeric RPC data as zero', async () => {
  const result = await runCampaignScheduleTick({
    rpc: async () => ({ data: null, error: null }),
  } as any);
  assert.deepEqual(result, { processed: 0, batches: 1 });
});
