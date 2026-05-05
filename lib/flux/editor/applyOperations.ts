import { makeFluxDefaultBlock } from '@/lib/flux/defaultCampaignTemplate';
import type {
  Block,
  ContentAsset,
  FluxPreviewProspectInput,
  FluxSellerProfileInput,
} from '@/lib/flux/types';
import type { FluxEditorOperation } from '@/lib/flux/editor/schemas';
import type { FluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';
import { normalizeFluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';

export interface FluxEditorDocumentState {
  name: string;
  offerDescription: string;
  blocks: Block[];
  contentAssets: ContentAsset[];
  copySlots: string;
  constraints: string;
  previewProspect: FluxPreviewProspectInput;
  sellerProfile: FluxSellerProfileInput;
  brandingPolicy: FluxBrandingPolicy;
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
    case 'block.setScrollTag': {
      return {
        ...state,
        blocks: state.blocks.map((b) => {
          if (b.id !== op.blockId) return b;
          const next = { ...b } as Block;
          if (op.scrollTag === null) {
            delete (next as { scrollTag?: string }).scrollTag;
          } else {
            const tag = op.scrollTag.trim();
            if (!tag) {
              delete (next as { scrollTag?: string }).scrollTag;
            } else {
              (next as { scrollTag?: string }).scrollTag = tag;
            }
          }
          return next;
        }),
      };
    }
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
    case 'asset.update': {
      const { assetId, patch } = op;
      return {
        ...state,
        contentAssets: state.contentAssets.map((a) => {
          if (a.id !== assetId) return a;
          return {
            ...a,
            ...(patch.type !== undefined ? { type: patch.type } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.body !== undefined ? { body: patch.body } : {}),
            ...(patch.metric !== undefined
              ? { metric: patch.metric === null ? undefined : patch.metric }
              : {}),
            ...(patch.attribution !== undefined
              ? { attribution: patch.attribution === null ? undefined : patch.attribution }
              : {}),
            ...(patch.imageUrl !== undefined
              ? { imageUrl: patch.imageUrl === null ? undefined : patch.imageUrl }
              : {}),
          };
        }),
      };
    }
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
    case 'seller.patchProfile':
      return {
        ...state,
        sellerProfile: {
          ...state.sellerProfile,
          ...op.patch,
        },
      };
    case 'seller.patchBrand':
      return {
        ...state,
        sellerProfile: {
          ...state.sellerProfile,
          brand_profile: {
            primaryColor: state.sellerProfile.brand_profile?.primaryColor ?? '#4f46e5',
            ...state.sellerProfile.brand_profile,
            ...op.patch,
          },
        },
      };
    case 'branding.setPolicy':
      return {
        ...state,
        brandingPolicy: normalizeFluxBrandingPolicy(op.policy),
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
