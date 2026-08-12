import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AdaptiveHealthGate, HealthRecycleError } from './health.ts';

describe('AdaptiveHealthGate', () => {
  it('increments recycle cycles across consecutive failures', async () => {
    const gate = new AdaptiveHealthGate([0, 0, 0]);
    await assert.rejects(
      gate.trip(new Error('first'), {
        country: 'US',
        location: 'TX',
        from: 0,
      }),
      (error: unknown) => error instanceof HealthRecycleError && error.cycle === 1,
    );
    await assert.rejects(
      gate.trip(new Error('second'), {
        country: 'US',
        location: 'TX',
        from: 100,
      }),
      (error: unknown) => error instanceof HealthRecycleError && error.cycle === 2,
    );
    assert.equal(gate.stats.failureCycle, 2);
    gate.recordDataSuccess();
    assert.equal(gate.stats.failureCycle, 0);
  });
});
