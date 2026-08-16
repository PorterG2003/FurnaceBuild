import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRelativeDay,
  formatRunwayThrough,
  formatRunwayWeeks,
  queueRunwayEndDate,
  queueRunwayWeeks,
} from './runway';

const days = [
  { date: '2026-07-20', sent: 100, replied: 0, positiveReply: 0, bounce: 0 },
  { date: '2026-07-27', sent: 100, replied: 0, positiveReply: 0, bounce: 0 },
  { date: '2026-08-03', sent: 100, replied: 0, positiveReply: 0, bounce: 0 },
  { date: '2026-08-10', sent: 100, replied: 0, positiveReply: 0, bounce: 0 },
];

test('queueRunwayWeeks divides queue by trailing 4-week send pace', () => {
  assert.equal(queueRunwayWeeks(400, days), 4);
  assert.equal(queueRunwayWeeks(200, days), 2);
});

test('queueRunwayWeeks returns null when there is no send pace', () => {
  assert.equal(queueRunwayWeeks(10, []), null);
  assert.equal(
    queueRunwayWeeks(10, [{ date: '2026-08-10', sent: 0, replied: 0, positiveReply: 0, bounce: 0 }]),
    null,
  );
});

test('formatRunwayWeeks', () => {
  assert.equal(formatRunwayWeeks(null), '—');
  assert.equal(formatRunwayWeeks(5.2), '5.2 wks');
  assert.equal(formatRunwayWeeks(0), '<0.1 wks');
});

test('formatRelativeDay uses today, tomorrow, weekday, then a date', () => {
  const now = new Date(2026, 7, 14);
  assert.equal(formatRelativeDay(new Date(2026, 7, 14), now), 'today');
  assert.equal(formatRelativeDay(new Date(2026, 7, 15), now), 'tomorrow');
  assert.equal(formatRelativeDay(new Date(2026, 7, 16), now), 'Sunday');
  assert.equal(formatRelativeDay(new Date(2026, 7, 21), now), 'Aug 21');
  assert.equal(formatRelativeDay(new Date(2027, 0, 2), now), 'Jan 2, 2027');
});

test('queueRunwayEndDate is today plus rounded runway days', () => {
  const now = new Date(2026, 7, 14);
  const end = queueRunwayEndDate(400, days, now);
  assert.ok(end);
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 8);
  assert.equal(end.getDate(), 11);
  assert.equal(formatRunwayThrough(end, now), 'Through Sep 11');
  assert.equal(formatRunwayThrough(queueRunwayEndDate(0, days, now), now), 'Through today');
});
