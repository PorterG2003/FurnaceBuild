import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultMetricsDateRange,
  findMatchingPreset,
  inclusiveUtcDayCount,
  presetRange,
  trendChartGrain,
  ymdUtcFromInstant,
} from './accountMetricsDateRange.js';

/** Fixed instant: 2026-05-15 12:00 UTC */
const REF = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));

test('ymdUtcFromInstant uses UTC calendar date', () => {
  assert.equal(ymdUtcFromInstant(REF), '2026-05-15');
});

test('presetRange last_7 is 7 inclusive UTC days ending today', () => {
  assert.deepEqual(presetRange('last_7', REF), {
    start: '2026-05-09',
    end: '2026-05-15',
  });
});

test('presetRange last_30 matches prior default window', () => {
  assert.deepEqual(presetRange('last_30', REF), {
    start: '2026-04-16',
    end: '2026-05-15',
  });
});

test('presetRange last_90', () => {
  assert.deepEqual(presetRange('last_90', REF), {
    start: '2026-02-15',
    end: '2026-05-15',
  });
});

test('presetRange ytd starts Jan 1 UTC of current year', () => {
  assert.deepEqual(presetRange('ytd', REF), {
    start: '2026-01-01',
    end: '2026-05-15',
  });
});

test('presetRange last_365 is 365 inclusive days', () => {
  assert.deepEqual(presetRange('last_365', REF), {
    start: '2025-05-16',
    end: '2026-05-15',
  });
});

test('presetRange last_30 across year boundary', () => {
  const newYear = new Date(Date.UTC(2026, 0, 3, 0, 0, 0));
  assert.deepEqual(presetRange('last_30', newYear), {
    start: '2025-12-05',
    end: '2026-01-03',
  });
});

test('findMatchingPreset returns preset id when range matches', () => {
  const r = presetRange('ytd', REF);
  assert.equal(findMatchingPreset(r.start, r.end, REF), 'ytd');
});

test('findMatchingPreset returns custom when no preset matches', () => {
  assert.equal(findMatchingPreset('2026-05-01', '2026-05-10', REF), 'custom');
});

test('defaultMetricsDateRange defaults to last_30 relative to now', () => {
  assert.deepEqual(defaultMetricsDateRange(REF), presetRange('last_30', REF));
});

test('inclusiveUtcDayCount is inclusive of start and end', () => {
  assert.equal(inclusiveUtcDayCount('2026-04-16', '2026-05-15'), 30);
  assert.equal(inclusiveUtcDayCount('2026-05-15', '2026-05-15'), 1);
  assert.equal(inclusiveUtcDayCount('2026-05-16', '2026-05-15'), 0);
});

test('trendChartGrain is daily through 41 days and weekly after', () => {
  assert.equal(trendChartGrain('2026-04-16', '2026-05-15'), 'day');
  assert.equal(trendChartGrain('2026-04-05', '2026-05-15'), 'day');
  assert.equal(trendChartGrain('2026-04-04', '2026-05-15'), 'week');
  assert.equal(trendChartGrain('2026-02-15', '2026-05-15'), 'week');
});
