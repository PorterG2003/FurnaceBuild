import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignStatPct } from './campaignStatPct';

test('campaignStatPct: zero denominator is 0', () => {
  assert.equal(campaignStatPct(5, 0), 0);
});

test('campaignStatPct: rounds to nearest integer', () => {
  assert.equal(campaignStatPct(1, 3), 33);
  assert.equal(campaignStatPct(2, 3), 67);
});

test('campaignStatPct: exact ratio', () => {
  assert.equal(campaignStatPct(1, 4), 25);
  assert.equal(campaignStatPct(0, 10), 0);
});
