import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarRunDaysBetween,
  haversineDistanceMeters,
  rankFluxCompetitorDomains,
  type FluxCompetitorScoredDomain,
} from './fluxCompetitorAuditRank.js';

test('calendarRunDaysBetween: same day is 0', () => {
  assert.equal(calendarRunDaysBetween('2026-04-29', '2026-04-29'), 0);
});

test('calendarRunDaysBetween: invalid returns null', () => {
  assert.equal(calendarRunDaysBetween('2026-05-01', '2026-04-01'), null);
});

test('haversineDistanceMeters: identical points', () => {
  assert.ok(haversineDistanceMeters(37.1, -113.5, 37.1, -113.5) < 1);
});

test('rankFluxCompetitorDomains: most recent last shown wins first', () => {
  const rows: FluxCompetitorScoredDomain[] = [
    {
      domain: 'older.com',
      placeIndex: 0,
      creativeCount: 99,
      latestAdLastShownAt: '2026-04-01',
      distanceMeters: 100,
      longestAdRunDays: 500,
    },
    {
      domain: 'newer.com',
      placeIndex: 9,
      creativeCount: 1,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 999_000,
      longestAdRunDays: null,
    },
  ];
  const [first] = rankFluxCompetitorDomains(rows);
  assert.equal(first.domain, 'newer.com');
});

test('rankFluxCompetitorDomains: same last shown then closer distance', () => {
  const rows: FluxCompetitorScoredDomain[] = [
    {
      domain: 'far.com',
      placeIndex: 0,
      creativeCount: 40,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 50_000,
      longestAdRunDays: 100,
    },
    {
      domain: 'near.com',
      placeIndex: 5,
      creativeCount: 5,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 500,
      longestAdRunDays: null,
    },
  ];
  const [first] = rankFluxCompetitorDomains(rows);
  assert.equal(first.domain, 'near.com');
});

test('rankFluxCompetitorDomains: same date and distance then higher creative count', () => {
  const rows: FluxCompetitorScoredDomain[] = [
    {
      domain: 'few.com',
      placeIndex: 0,
      creativeCount: 2,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 1000,
      longestAdRunDays: 50,
    },
    {
      domain: 'many.com',
      placeIndex: 3,
      creativeCount: 40,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 1000,
      longestAdRunDays: 10,
    },
  ];
  const [first] = rankFluxCompetitorDomains(rows);
  assert.equal(first.domain, 'many.com');
});

test('rankFluxCompetitorDomains: then longest ad run then placeIndex', () => {
  const rows: FluxCompetitorScoredDomain[] = [
    {
      domain: 'short-run.com',
      placeIndex: 1,
      creativeCount: 10,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 2000,
      longestAdRunDays: 5,
    },
    {
      domain: 'long-run.com',
      placeIndex: 9,
      creativeCount: 10,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 2000,
      longestAdRunDays: 400,
    },
    {
      domain: 'tie-place.com',
      placeIndex: 0,
      creativeCount: 10,
      latestAdLastShownAt: '2026-04-29',
      distanceMeters: 2000,
      longestAdRunDays: 400,
    },
  ];
  const ranked = rankFluxCompetitorDomains(rows);
  assert.deepEqual(
    ranked.map((r) => r.domain),
    ['tie-place.com', 'long-run.com', 'short-run.com'],
  );
});
