import assert from 'node:assert/strict';
import test from 'node:test';
import { runPool } from './pool.js';

test('runPool visits every item with bounded concurrency', async () => {
  const seen: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(n);
    inFlight -= 1;
  });
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.ok(maxInFlight <= 2);
});
