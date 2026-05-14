import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAnchoredSelection } from './applyAnchoredSelection';

test('applyAnchoredSelection toggles a single row without shift', () => {
  const next = applyAnchoredSelection(new Set(['a']), ['a', 'b', 'c'], 'a', 'c');
  assert.deepEqual([...next], ['a', 'c']);
});

test('applyAnchoredSelection selects a range when shift is pressed', () => {
  const next = applyAnchoredSelection(
    new Set(['a']),
    ['a', 'b', 'c', 'd'],
    'a',
    'c',
    { shiftKey: true }
  );
  assert.deepEqual([...next], ['a', 'b', 'c']);
});

test('applyAnchoredSelection deselects a selected range when shift is pressed', () => {
  const next = applyAnchoredSelection(
    new Set(['a', 'b', 'c', 'd']),
    ['a', 'b', 'c', 'd'],
    'b',
    'd',
    { shiftKey: true }
  );
  assert.deepEqual([...next], ['a']);
});

test('applyAnchoredSelection falls back to a single row when shift has no anchor', () => {
  const next = applyAnchoredSelection(
    new Set(['a']),
    ['a', 'b', 'c'],
    null,
    'c',
    { shiftKey: true }
  );
  assert.deepEqual([...next], ['a', 'c']);
});
