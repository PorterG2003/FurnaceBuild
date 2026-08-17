/** 10px semibold "9999" — two of these must fit on adjacent bars. */
export const MIN_FOUR_DIGIT_LABEL_WIDTH = 28;
export const BAR_WIDTH = MIN_FOUR_DIGIT_LABEL_WIDTH;
export const BAR_INTRA_GAP = 4;
export const BAR_GROUP_GAP = 16;

/** Width of the bars + intra-gaps in one category group (no trailing slot gap). */
export function barGroupInnerWidth(seriesCount: number): number {
  const n = Math.max(1, seriesCount);
  return n * BAR_WIDTH + Math.max(n - 1, 0) * BAR_INTRA_GAP;
}

/**
 * Spacing after the last bar in a group so the group occupies the shared category
 * `slotWidth`. Use per panel (`n` = that panel's series count), not the max series count.
 */
export function barGroupTrailingGap(slotWidth: number, seriesCount: number): number {
  return slotWidth - barGroupInnerWidth(seriesCount);
}

/** Gifted-charts advances `inner + trailing` per category; this must equal `slotWidth`. */
export function barGroupOccupiedWidth(slotWidth: number, seriesCount: number): number {
  return barGroupInnerWidth(seriesCount) + barGroupTrailingGap(slotWidth, seriesCount);
}
