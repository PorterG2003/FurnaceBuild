import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeActivity } from './formatRelativeActivity';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h);

test('formatRelativeActivity uses calendar-day context', () => {
  const now = at(2026, 4, 25, 18);
  assert.equal(formatRelativeActivity(at(2026, 4, 25, 9).toISOString(), now), 'Today');
  assert.equal(formatRelativeActivity(at(2026, 4, 24, 23).toISOString(), now), 'Yesterday');
  assert.equal(formatRelativeActivity(at(2026, 4, 23).toISOString(), now), '2 days ago');
  assert.equal(formatRelativeActivity(at(2026, 4, 18).toISOString(), now), '1 week ago');
  assert.equal(formatRelativeActivity(at(2026, 4, 11).toISOString(), now), '2 weeks ago');
});
