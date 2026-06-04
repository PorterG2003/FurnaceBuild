import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForInviteActivation } from './activation';

test('waitForInviteActivation returns ready when membership appears during polling', async () => {
  let attempts = 0;

  const result = await waitForInviteActivation({
    delayMs: 0,
    async checkMemberships() {
      attempts += 1;
      return attempts >= 3 ? 1 : 0;
    },
  });

  assert.deepEqual(result, { kind: 'ready' });
  assert.equal(attempts, 3);
});

test('waitForInviteActivation returns timed_out when memberships never appear', async () => {
  const result = await waitForInviteActivation({
    delayMs: 0,
    maxAttempts: 3,
    async checkMemberships() {
      return 0;
    },
  });

  assert.deepEqual(result, { kind: 'timed_out' });
});

test('waitForInviteActivation returns an error result when membership lookup fails', async () => {
  const result = await waitForInviteActivation({
    delayMs: 0,
    async checkMemberships() {
      throw new Error('Failed to fetch account memberships');
    },
  });

  assert.deepEqual(result, {
    kind: 'error',
    message: 'Failed to fetch account memberships',
  });
});
