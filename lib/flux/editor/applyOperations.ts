import { makeFluxDefaultBlock } from '@/lib/flux/defaultCampaignTemplate';
import type {
  Block,
  ContentAsset,
  FluxPreviewProspectInput,
} from '@/lib/flux/types';
import type { FluxEditorOperation } from '@/lib/flux/editor/schemas';

export interface FluxEditorDocumentState {
  name: string;
  offerDescription: string;
  blocks: Block[];
  contentAssets: ContentAsset[];
  copySlots: string;
  constraints: string;
  previewProspect: FluxPreviewProspectInput;
  editingBlockId: string | null;
}

function sortBlocksByOrder(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Applies one validated remote operation to a document snapshot (immutable). */
export function applyFluxEditorOperation(
  state: FluxEditorDocumentState,
  op: FluxEditorOperation,
): FluxEditorDocumentState {
  switch (op.type) {
    case 'campaign.setName':
      return { ...state, name: op.value };
    case 'campaign.setOfferDescription':
      return { ...state, offerDescription: op.value };
    case 'block.add': {
      const sorted = sortBlocksByOrder(state.blocks);
      const idx = op.index != null ? Math.min(op.index, sorted.length) : sorted.length;
      const b = makeFluxDefaultBlock(op.blockType, idx);
      const next = [...sorted];
      next.splice(idx, 0, b);
      const reordered = next.map((block, i) => ({ ...block, order: i }));
      return { ...state, blocks: reordered, editingBlockId: b.id };
    }
    case 'block.remove': {
      const next = state.blocks
        .filter((b) => b.id !== op.blockId)
        .map((b, i) => ({ ...b, order: i }));
      return {
        ...state,
        blocks: next,
        editingBlockId: state.editingBlockId === op.blockId ? null : state.editingBlockId,
      };
    }
    case 'block.updateProps':
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.id === op.blockId ? ({ ...b, props: { ...b.props, ...op.props } } as Block) : b,
        ),
      };
    case 'block.reorder': {
      const byId = new Map(state.blocks.map((b) => [b.id, b]));
      const ordered: Block[] = [];
      for (const id of op.blockIds) {
        const b = byId.get(id);
        if (b) ordered.push(b);
      }
      if (ordered.length !== state.blocks.length) {
        return state;
      }
      const reindexed = ordered.map((b, i) => ({ ...b, order: i }));
      return { ...state, blocks: reindexed };
    }
    case 'asset.add':
      return { ...state, contentAssets: [...state.contentAssets, op.asset] };
    case 'asset.remove':
      return {
        ...state,
        contentAssets: state.contentAssets.filter((a) => a.id !== op.assetId),
      };
    case 'template.setCopySlots':
      return { ...state, copySlots: op.value.join(', ') };
    case 'template.setConstraints':
      return { ...state, constraints: op.value };
    case 'preview.patchProspect':
      return {
        ...state,
        previewProspect: {
          ...state.previewProspect,
          ...op.patch,
          brand_profile: state.previewProspect.brand_profile,
        },
      };
    case 'preview.patchBrand':
      return {
        ...state,
        previewProspect: {
          ...state.previewProspect,
          brand_profile: {
            primaryColor: state.previewProspect.brand_profile?.primaryColor ?? '#4f46e5',
            ...state.previewProspect.brand_profile,
            ...op.patch,
          },
        },
      };
    default:
      return state;
  }
}

export function applyFluxEditorOperations(
  state: FluxEditorDocumentState,
  operations: FluxEditorOperation[],
): FluxEditorDocumentState {
  return operations.reduce(applyFluxEditorOperation, state);
}
