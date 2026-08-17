import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRelativeDay,
  formatRunwayThrough,
  formatRunwayWeeks,
  queueRunwayDays,
  queueRunwayEndDate,
  queueRunwayWeeks,
} from './runway';

test('queueRunwayDays divides queue by daily send capacity', () => {
  assert.equal(queueRunwayDays(400, 100), 4);
  assert.equal(queueRunwayDays(200, 100), 2);
  assert.equal(queueRunwayWeeks(700, 100), 1);
});

test('queueRunwayDays returns null when there is no send capacity', () => {
  assert.equal(queueRunwayDays(10, 0), null);
  assert.equal(queueRunwayDays(10, -1), null);
  assert.equal(queueRunwayWeeks(10, 0), null);
  assert.equal(queueRunwayEndDate(10, 0), null);
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
  const end = queueRunwayEndDate(400, 100, now);
  assert.ok(end);
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 7);
  assert.equal(end.getDate(), 18);
  assert.equal(formatRunwayThrough(end, now), 'Through Tuesday');
  assert.equal(formatRunwayThrough(queueRunwayEndDate(0, 100, now), now), 'Through today');
});
