import { applyRangeSelection } from './applyRangeSelection';

interface AnchoredSelectionModifiers {
  shiftKey?: boolean;
}

export function applyAnchoredSelection(
  selectedIds: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string | null,
  targetId: string,
  modifiers?: AnchoredSelectionModifiers
): Set<string> {
  const shouldSelect = !selectedIds.has(targetId);

  if (modifiers?.shiftKey) {
    return applyRangeSelection(selectedIds, orderedIds, anchorId, targetId, shouldSelect);
  }

  return applyRangeSelection(selectedIds, orderedIds, targetId, targetId, shouldSelect);
}
