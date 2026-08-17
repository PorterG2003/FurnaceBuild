import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAR_GROUP_GAP,
  BAR_INTRA_GAP,
  BAR_WIDTH,
  barGroupInnerWidth,
  barGroupOccupiedWidth,
  barGroupTrailingGap,
} from './accountTrendChartLayout';

test('1-bar, 2-bar, and 3-bar groups occupy the same slotWidth', () => {
  const widest = barGroupInnerWidth(3);
  const slotWidth = widest + BAR_GROUP_GAP;
  for (const n of [1, 2, 3]) {
    assert.equal(barGroupOccupiedWidth(slotWidth, n), slotWidth);
  }
});

test('barGroupTrailingGap fills leftover after a narrower group', () => {
  const slotWidth = barGroupInnerWidth(3) + BAR_GROUP_GAP;
  const twoBarInner = 2 * BAR_WIDTH + BAR_INTRA_GAP;
  assert.equal(barGroupInnerWidth(2), twoBarInner);
  assert.equal(barGroupTrailingGap(slotWidth, 2), slotWidth - twoBarInner);
});
