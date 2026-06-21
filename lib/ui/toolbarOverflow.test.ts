import test from 'node:test';
import assert from 'node:assert/strict';
import { computeToolbarOverflowSplit, type ToolbarOverflowItem } from './toolbarOverflow';

const ITEMS: ToolbarOverflowItem[] = [
  { key: 'close', priority: 0, width: 120 },
  { key: 'block', priority: 1, width: 100 },
  { key: 'ooo', priority: 2, width: 110 },
];

test('returns all items visible when everything fits', () => {
  const result = computeToolbarOverflowSplit(ITEMS, 360);
  assert.deepEqual(result, {
    visibleKeys: ['close', 'block', 'ooo'],
    overflowKeys: [],
  });
});

test('moves lower priority items into overflow when width is limited', () => {
  const result = computeToolbarOverflowSplit(ITEMS, 240);
  assert.deepEqual(result, {
    visibleKeys: ['close'],
    overflowKeys: ['block', 'ooo'],
  });
});

test('keeps two highest priority items visible when they fit with overflow trigger', () => {
  const result = computeToolbarOverflowSplit(ITEMS, 340);
  assert.deepEqual(result, {
    visibleKeys: ['close', 'block'],
    overflowKeys: ['ooo'],
  });
});

test('reserves inbox overflow trigger width when computing visible items', () => {
  const result = computeToolbarOverflowSplit(
    [{ key: 'close', priority: 0, width: 120 }],
    160,
    { gap: 8, overflowTriggerWidth: 32 },
  );
  assert.deepEqual(result, {
    visibleKeys: ['close'],
    overflowKeys: [],
  });
});

test('returns no visible items when container width is zero', () => {
  const result = computeToolbarOverflowSplit(ITEMS, 0);
  assert.deepEqual(result, {
    visibleKeys: [],
    overflowKeys: ['close', 'block', 'ooo'],
  });
});

test('keeps oversized first item in overflow when nothing fits beside trigger', () => {
  const result = computeToolbarOverflowSplit([{ key: 'close', priority: 0, width: 180 }], 120);
  assert.deepEqual(result, {
    visibleKeys: [],
    overflowKeys: ['close'],
  });
});

test('fixed-width items produce deterministic slot counts', () => {
  const result = computeToolbarOverflowSplit(
    [
      { key: 'close', priority: 0, width: 132 },
      { key: 'block', priority: 2, width: 132 },
      { key: 'ooo', priority: 3, width: 132 },
      { key: 'replace', priority: 4, width: 132 },
    ],
    420,
    { gap: 8, overflowTriggerWidth: 32 },
  );

  assert.deepEqual(result, {
    visibleKeys: ['close', 'block'],
    overflowKeys: ['ooo', 'replace'],
  });
});
