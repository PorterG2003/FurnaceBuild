export function applyRangeSelection(
  selectedIds: ReadonlySet<string>,
  orderedIds: readonly string[],
  startId: string | null,
  endId: string,
  shouldSelect: boolean
): Set<string> {
  const next = new Set(selectedIds);

  const endIndex = orderedIds.indexOf(endId);
  if (endIndex === -1) return next;

  const startIndex = startId != null ? orderedIds.indexOf(startId) : -1;
  if (startIndex === -1) {
    if (shouldSelect) next.add(endId);
    else next.delete(endId);
    return next;
  }

  const rangeStart = Math.min(startIndex, endIndex);
  const rangeEnd = Math.max(startIndex, endIndex);

  for (let index = rangeStart; index <= rangeEnd; index += 1) {
    const id = orderedIds[index];
    if (!id) continue;
    if (shouldSelect) next.add(id);
    else next.delete(id);
  }

  return next;
}
