export interface ToolbarOverflowItem {
  key: string;
  priority: number;
  width: number;
}

interface ToolbarOverflowOptions {
  gap?: number;
  overflowTriggerWidth?: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_OVERFLOW_TRIGGER_WIDTH = 36;

function getRowWidth(items: ToolbarOverflowItem[], gap: number) {
  if (items.length === 0) return 0;
  const totalWidth = items.reduce((sum, item) => sum + Math.max(0, item.width), 0);
  return totalWidth + gap * Math.max(0, items.length - 1);
}

export function computeToolbarOverflowSplit(
  items: ToolbarOverflowItem[],
  containerWidth: number,
  options: ToolbarOverflowOptions = {},
): { visibleKeys: string[]; overflowKeys: string[] } {
  const gap = options.gap ?? DEFAULT_GAP;
  const overflowTriggerWidth = options.overflowTriggerWidth ?? DEFAULT_OVERFLOW_TRIGGER_WIDTH;
  const sortedItems = [...items].sort((a, b) => a.priority - b.priority);

  if (sortedItems.length === 0 || containerWidth <= 0) {
    return { visibleKeys: [], overflowKeys: sortedItems.map((item) => item.key) };
  }

  if (getRowWidth(sortedItems, gap) <= containerWidth) {
    return {
      visibleKeys: sortedItems.map((item) => item.key),
      overflowKeys: [],
    };
  }

  const visibleItems: ToolbarOverflowItem[] = [];
  const overflowItems: ToolbarOverflowItem[] = [];
  const reservedWidth = overflowTriggerWidth + gap;
  let usedWidth = 0;

  for (const item of sortedItems) {
    const nextWidth = visibleItems.length === 0 ? item.width : item.width + gap;
    const availableWidth = Math.max(0, containerWidth - reservedWidth);
    if (usedWidth + nextWidth <= availableWidth) {
      visibleItems.push(item);
      usedWidth += nextWidth;
    } else {
      overflowItems.push(item);
    }
  }

  return {
    visibleKeys: visibleItems.map((item) => item.key),
    overflowKeys: overflowItems.map((item) => item.key),
  };
}
