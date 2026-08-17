import test from 'node:test';
import assert from 'node:assert/strict';
import { fillMissingStatsByDay } from './fillMissingStatsByDay';

test('fillMissingStatsByDay zeros missing days including leadsFirstContacted', () => {
  const filled = fillMissingStatsByDay(
    [
      {
        date: '2026-08-10',
        sent: 4,
        replied: 1,
        positiveReply: 1,
        bounce: 0,
        leadsFirstContacted: 2,
      },
    ],
    '2026-08-10',
    '2026-08-12',
  );
  assert.deepEqual(filled, [
    {
      date: '2026-08-10',
      sent: 4,
      replied: 1,
      positiveReply: 1,
      bounce: 0,
      leadsFirstContacted: 2,
    },
    {
      date: '2026-08-11',
      sent: 0,
      replied: 0,
      positiveReply: 0,
      bounce: 0,
      leadsFirstContacted: 0,
    },
    {
      date: '2026-08-12',
      sent: 0,
      replied: 0,
      positiveReply: 0,
      bounce: 0,
      leadsFirstContacted: 0,
    },
  ]);
});
