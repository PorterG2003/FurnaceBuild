import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRangeSelection } from './applyRangeSelection';

test('applyRangeSelection selects a forward range', () => {
  const next = applyRangeSelection(new Set(['a']), ['a', 'b', 'c', 'd'], 'a', 'c', true);
  assert.deepEqual([...next], ['a', 'b', 'c']);
});

test('applyRangeSelection selects a reverse range', () => {
  const next = applyRangeSelection(new Set(), ['a', 'b', 'c', 'd'], 'd', 'b', true);
  assert.deepEqual([...next], ['b', 'c', 'd']);
});

test('applyRangeSelection deselects a range', () => {
  const next = applyRangeSelection(new Set(['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'], 'b', 'c', false);
  assert.deepEqual([...next], ['a', 'd']);
});

test('applyRangeSelection falls back to a single row when no anchor exists', () => {
  const next = applyRangeSelection(new Set(['a']), ['a', 'b', 'c'], null, 'c', true);
  assert.deepEqual([...next], ['a', 'c']);
});
