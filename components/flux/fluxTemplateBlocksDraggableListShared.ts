import type { ReactNode } from 'react';
import type { Block, BlockType, ContentAsset } from '@/lib/flux/types';

export function sortBlocksByOrder(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export interface FluxTemplateBlocksDraggableListProps {
  blocks: Block[];
  blockTypeLabels: Record<BlockType, string>;
  blockSummary: (block: Block) => string;
  editingBlockId: string | null;
  onToggleEditing: (blockId: string) => void;
  onRemove: (blockId: string) => void;
  onReorder: (nextOrdered: Block[]) => void;
  updateBlockProps: (blockId: string, newProps: Record<string, unknown>) => void;
  contentAssets: ContentAsset[];
  renderBlockEditor: (
    block: Block,
    updateProps: (id: string, props: Record<string, unknown>) => void,
    assets: ContentAsset[],
  ) => ReactNode;
}
