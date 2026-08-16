import test from 'node:test';
import assert from 'node:assert/strict';
import { countPerOutcome, formatCountPerOutcome, formatRate, hasReliableRate, yieldPerThousand } from './lowVolume';

test('formatRate shows counts below the minimum denominator', () => {
  assert.equal(formatRate(3, 40), '3 / 40');
  assert.equal(formatRate(13, 100), '13%');
  assert.equal(formatRate(1, 3, 10), '1 / 3');
});

test('hasReliableRate', () => {
  assert.equal(hasReliableRate(99), false);
  assert.equal(hasReliableRate(100), true);
});

test('yieldPerThousand', () => {
  assert.equal(yieldPerThousand(8, 1000), 8);
  assert.equal(yieldPerThousand(1, 0), null);
});

test('countPerOutcome', () => {
  assert.equal(countPerOutcome(14338, 29), 494.4);
  assert.equal(countPerOutcome(100, 0), null);
  assert.equal(formatCountPerOutcome(494.4), '494.4');
  assert.equal(formatCountPerOutcome(null), '—');
});
