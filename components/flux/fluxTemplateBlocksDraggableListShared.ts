import type { ReactNode } from 'react';
import type { FluxBlockStylePreset } from '@/lib/flux/fluxPresentationTokens';
import type { Block, BlockType, ContentAsset } from '@/lib/flux/types';

export function sortBlocksByOrder(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export type FluxBlockEditorLayout = {
  /** When true, short paired fields (e.g. CTA + URL) render in two columns when space allows. */
  pairFieldColumns?: boolean;
  /** Active block style preset (drives layout-specific fields such as case study image URL). */
  blockStylePreset?: FluxBlockStylePreset;
};

export interface FluxTemplateBlocksDraggableListProps {
  blocks: Block[];
  blockTypeLabels: Record<BlockType, string>;
  blockSummary: (block: Block) => string;
  editingBlockId: string | null;
  onToggleEditing: (blockId: string) => void;
  onRemove: (blockId: string) => void;
  onReorder: (nextOrdered: Block[]) => void;
  updateBlockProps: (blockId: string, newProps: Record<string, unknown>) => void;
  updateBlockScrollTag: (blockId: string, scrollTag: string | undefined) => void;
  contentAssets: ContentAsset[];
  renderBlockEditor: (
    block: Block,
    updateProps: (id: string, props: Record<string, unknown>) => void,
    assets: ContentAsset[],
    layout?: FluxBlockEditorLayout,
  ) => ReactNode;
  /** When false, hide remove control (e.g. prospect page blocks). Default true. */
  allowRemoveBlocks?: boolean;
  pairFieldColumns?: boolean;
  blockStylePreset?: FluxBlockStylePreset;
}
