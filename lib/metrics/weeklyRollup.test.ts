import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWeekLabel, isoWeekStartUtc, rollupDailyToIsoWeeks } from './weeklyRollup';

test('isoWeekStartUtc uses Monday as week start', () => {
  assert.equal(isoWeekStartUtc('2026-08-14'), '2026-08-10');
  assert.equal(isoWeekStartUtc('2026-08-10'), '2026-08-10');
  assert.equal(isoWeekStartUtc('2026-08-09'), '2026-08-03');
});

test('rollupDailyToIsoWeeks sums sent/replied/positive/bounce/leadsFirstContacted by ISO week', () => {
  const rows = rollupDailyToIsoWeeks([
    { date: '2026-08-10', sent: 10, replied: 1, positiveReply: 1, bounce: 0, leadsFirstContacted: 4 },
    { date: '2026-08-11', sent: 5, replied: 2, positiveReply: 0, bounce: 1, leadsFirstContacted: 2 },
    { date: '2026-08-17', sent: 3, replied: 0, positiveReply: 0, bounce: 0, leadsFirstContacted: 1 },
  ]);
  assert.deepEqual(rows, [
    { weekStart: '2026-08-10', sent: 15, replied: 3, positiveReply: 1, bounce: 1, leadsFirstContacted: 6 },
    { weekStart: '2026-08-17', sent: 3, replied: 0, positiveReply: 0, bounce: 0, leadsFirstContacted: 1 },
  ]);
});

test('formatWeekLabel is UTC month/day', () => {
  assert.equal(formatWeekLabel('2026-08-10'), 'Aug 10');
});
