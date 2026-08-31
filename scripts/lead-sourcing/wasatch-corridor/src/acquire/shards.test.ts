import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateApolloSearchPages, listApolloShards } from './shards.js';
import { parseCliArgs, PILOT_BANDS, PILOT_CITIES } from '../lib/cli.js';

test('full shard list is city x band plus metros', () => {
  const shards = listApolloShards();
  assert.equal(shards.length, 235);
});

test('pilot filter is three cities by two bands', () => {
  const shards = listApolloShards({ cities: [...PILOT_CITIES], bands: [...PILOT_BANDS] });
  assert.equal(shards.length, 6);
  assert.ok(shards.every((s) => s.location.includes('Lehi') || s.location.includes('Midvale') || s.location.includes('Payson')));
  assert.ok(shards.every((s) => s.employee_band === '11,20' || s.employee_band === '21,50'));
  const est = estimateApolloSearchPages(shards.length);
  assert.equal(est.estimated_credits_low, 7);
  assert.equal(est.estimated_credits_high, 11);
});

test('--pilot sets cities, bands, skips, and a 12-call cap', () => {
  const cli = parseCliArgs(['--pilot', '--dry-run']);
  assert.deepEqual(cli.cities, [...PILOT_CITIES]);
  assert.deepEqual(cli.bands, [...PILOT_BANDS]);
  assert.equal(cli.skipFsq, true);
  assert.equal(cli.skipEpa, true);
  assert.equal(cli.maxApolloCalls, 12);
  assert.equal(cli.maxOrgEnrich, null);
});

test('--skip-people and --skip-geo parse', () => {
  const cli = parseCliArgs(['--skip-people', '--skip-geo']);
  assert.equal(cli.skipPeople, true);
  assert.equal(cli.skipGeo, true);
});

test('--county utah parses', () => {
  const cli = parseCliArgs(['--county', 'utah']);
  assert.equal(cli.county, 'utah');
});

test('--cities Orem,Provo parses', () => {
  const cli = parseCliArgs(['--cities', 'Orem,Provo']);
  assert.deepEqual(cli.cities, ['Orem', 'Provo']);
});
