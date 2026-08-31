import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logLift } from './profileModel.js';

describe('logLift shrinkage', () => {
  it('returns 0 lift when a bin has no wins', () => {
    const { shrunk } = logLift(0, 1000, 0.03, 15);
    assert.equal(shrunk, 0);
  });

  it('shrinks thin bins toward zero and keeps full lift at min_wins', () => {
    const base = 0.03;
    const thin = logLift(3, 10, base, 15);
    const full = logLift(15, 50, base, 15);
    assert.ok(Math.abs(thin.shrunk) < Math.abs(thin.raw));
    assert.equal(thin.shrunk, thin.raw * (3 / 15));
    assert.equal(full.shrunk, full.raw);
    assert.ok(full.raw > 0);
  });
});
