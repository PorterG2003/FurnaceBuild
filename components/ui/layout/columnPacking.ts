/**
 * Bin-packing for two columns: assign items to left/right so column heights are balanced.
 * Processes items in order; each item goes into the column with the smaller current total height.
 * Missing heights are treated as 0.
 */
export function computeTwoColumnAssignment(
  itemIds: string[],
  heights: Record<string, number>
): { left: string[]; right: string[] } {
  let leftTotal = 0;
  let rightTotal = 0;
  const left: string[] = [];
  const right: string[] = [];

  for (const id of itemIds) {
    const h = heights[id] ?? 0;
    if (leftTotal <= rightTotal) {
      left.push(id);
      leftTotal += h;
    } else {
      right.push(id);
      rightTotal += h;
    }
  }

  return { left, right };
}
