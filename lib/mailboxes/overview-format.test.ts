import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMailboxLastSent } from './overview-format';

test('formatMailboxLastSent returns relative minute/hour/day labels for recent sends', () => {
  const realNow = Date.now;
  Date.now = () => new Date('2026-05-13T18:00:00.000Z').getTime();

  try {
    assert.equal(formatMailboxLastSent('2026-05-13T17:45:00.000Z'), '15m ago');
    assert.equal(formatMailboxLastSent('2026-05-13T14:00:00.000Z'), '4h ago');
    assert.equal(formatMailboxLastSent('2026-05-10T18:00:00.000Z'), '3d ago');
  } finally {
    Date.now = realNow;
  }
});

test('formatMailboxLastSent handles empty and stale values', () => {
  const realNow = Date.now;
  Date.now = () => new Date('2026-05-13T18:00:00.000Z').getTime();

  try {
    assert.equal(formatMailboxLastSent(null), 'Never');
    assert.equal(formatMailboxLastSent('not-a-date'), 'Unknown');
    assert.equal(formatMailboxLastSent('2026-05-01T18:00:00.000Z'), 'May 1');
  } finally {
    Date.now = realNow;
  }
});
