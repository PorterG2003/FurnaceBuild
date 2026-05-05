import type {
  Block,
  ContentAsset,
  FluxPreviewProspectInput,
  FluxSellerProfileInput,
  FluxWebsiteIntelSnapshot,
} from '@/lib/flux/types';
import type { FluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';
import type { FluxBlockStylePreset } from '@/lib/flux/fluxPresentationTokens';
import { applyFluxEditorOperation, type FluxEditorDocumentState } from '@/lib/flux/editor/applyOperations';
import type { FluxEditorOperation } from '@/lib/flux/editor/schemas';
import { makeFluxDefaultBlock } from '@/lib/flux/defaultCampaignTemplate';
import { emptyFluxSellerProfile } from '@/lib/flux/campaignSeller';
import { defaultFluxBrandingPolicy, normalizeFluxBrandingPolicy } from '@/lib/flux/fluxBrandingPolicy';
import {
  getLastFluxChatSummary,
  type FluxCampaignChatMessage,
  type FluxCampaignChatState,
  type FluxEditorCheckpoint,
} from '@/lib/flux/fluxCampaignChatState';
export type FluxChatMessage = FluxCampaignChatMessage;

export interface FluxCampaignEditorState extends FluxEditorDocumentState {
  previewProspectOpen: boolean;
  chatMessages: FluxChatMessage[];
  chatSending: boolean;
  chatError: string | null;
  chatLastSummary: string[] | null;
  chatCheckpoints: Record<string, FluxEditorCheckpoint>;
}

export type FluxCampaignEditorAction =
  | {
      type: 'hydrate';
      payload: {
        name: string;
        offerDescription: string;
        blocks: Block[];
        contentAssets: ContentAsset[];
        copySlots: string;
        constraints: string;
        /** Persisted editor chat from `flux_campaign_templates.chat_state` (normalized). */
        chatState: FluxCampaignChatState;
        /** When omitted, existing preview prospect is preserved (matches legacy load behavior). */
        previewProspect?: FluxPreviewProspectInput;
        sellerProfile?: FluxSellerProfileInput;
        brandingPolicy?: FluxBrandingPolicy;
      };
    }
  | {
      type: 'seller.patchProfile';
      patch: Partial<Pick<FluxSellerProfileInput, 'displayName' | 'tagline' | 'websiteUrl'>>;
    }
  | {
      type: 'seller.patchBrand';
      patch: {
        primaryColor?: string;
        accentColor?: string;
        fontFamily?: string;
        logoUrl?: string;
        blockStylePreset?: FluxBlockStylePreset;
      };
    }
  | { type: 'seller.setIntel'; value: FluxWebsiteIntelSnapshot | null }
  | {
      type: 'seller.setMeta';
      patch: Partial<
        Pick<FluxSellerProfileInput, 'websiteDomainKey' | 'foundryCompanyId' | 'websiteIntelAutoFilledAt'>
      >;
    }
  | { type: 'branding.setPolicy'; value: FluxBrandingPolicy }
  | { type: 'campaign.setName'; value: string }
  | { type: 'campaign.setOfferDescription'; value: string }
  | { type: 'block.add'; blockType: Block['type']; index?: number }
  | { type: 'block.remove'; blockId: string }
  | { type: 'block.updateProps'; blockId: string; props: Record<string, unknown> }
  | { type: 'block.setScrollTag'; blockId: string; scrollTag: string | null }
  | { type: 'block.setBlocks'; blocks: Block[] }
  | { type: 'asset.add'; asset: ContentAsset }
  | { type: 'asset.remove'; assetId: string }
  | {
      type: 'asset.update';
      assetId: string;
      patch: Partial<
        Pick<ContentAsset, 'type' | 'title' | 'body' | 'metric' | 'attribution' | 'imageUrl'>
      >;
    }
  | { type: 'template.setCopySlotsText'; value: string }
  | { type: 'template.setConstraints'; value: string }
  | { type: 'preview.patchProspect'; patch: Partial<FluxPreviewProspectInput> }
  | {
      type: 'preview.patchBrand';
      patch: {
        primaryColor?: string;
        accentColor?: string;
        fontFamily?: string;
        logoUrl?: string;
        blockStylePreset?: FluxBlockStylePreset;
      };
    }
  | { type: 'preview.setProspect'; value: FluxPreviewProspectInput }
  | { type: 'ui.setPreviewProspectOpen'; value: boolean }
  | { type: 'ui.setEditingBlockId'; value: string | null }
  | { type: 'ui.toggleEditingBlock'; blockId: string }
  | { type: 'chat.appendUser'; id: string; content: string; checkpoint: FluxEditorCheckpoint }
  | { type: 'chat.appendAssistant'; id: string; content: string; summary?: string[] }
  | { type: 'chat.setSending'; value: boolean }
  | { type: 'chat.setError'; value: string | null }
  | { type: 'chat.clearMessages' }
  | { type: 'chat.restore'; value: FluxCampaignChatState | null }
  | { type: 'chat.applyRemoteOperations'; operations: FluxEditorOperation[] }
  | { type: 'chat.rewindToCheckpoint'; messageId: string };

function toDoc(s: FluxCampaignEditorState): FluxEditorDocumentState {
  const {
    previewProspectOpen: _o,
    chatMessages: _m,
    chatSending: _s,
    chatError: _e,
    chatLastSummary: _l,
    chatCheckpoints: _c,
    ...doc
  } = s;
  return doc;
}

export function checkpointFromEditorState(s: FluxCampaignEditorState): FluxEditorCheckpoint {
  return {
    name: s.name,
    offerDescription: s.offerDescription,
    blocks: JSON.parse(JSON.stringify(s.blocks)) as Block[],
    contentAssets: JSON.parse(JSON.stringify(s.contentAssets)) as ContentAsset[],
    copySlots: s.copySlots,
    constraints: s.constraints,
    previewProspect: JSON.parse(JSON.stringify(s.previewProspect)) as FluxPreviewProspectInput,
    sellerProfile: JSON.parse(JSON.stringify(s.sellerProfile)) as FluxSellerProfileInput,
    brandingPolicy: JSON.parse(JSON.stringify(s.brandingPolicy)) as FluxBrandingPolicy,
    editingBlockId: s.editingBlockId,
  };
}

export function initialFluxCampaignEditorState(
  previewProspect: FluxPreviewProspectInput,
): FluxCampaignEditorState {
  return {
    name: '',
    offerDescription: '',
    blocks: [],
    contentAssets: [],
    copySlots: '',
    constraints: '',
    previewProspect,
    sellerProfile: emptyFluxSellerProfile(),
    brandingPolicy: defaultFluxBrandingPolicy(),
    previewProspectOpen: true,
    editingBlockId: null,
    chatMessages: [],
    chatSending: false,
    chatError: null,
    chatLastSummary: null,
    chatCheckpoints: {},
  };
}

export function fluxCampaignEditorReducer(
  state: FluxCampaignEditorState,
  action: FluxCampaignEditorAction,
): FluxCampaignEditorState {
  switch (action.type) {
    case 'hydrate': {
      const { chatState } = action.payload;
      return {
        ...state,
        name: action.payload.name,
        offerDescription: action.payload.offerDescription,
        blocks: action.payload.blocks,
        contentAssets: action.payload.contentAssets,
        copySlots: action.payload.copySlots,
        constraints: action.payload.constraints,
        previewProspect: action.payload.previewProspect ?? state.previewProspect,
        sellerProfile: action.payload.sellerProfile ?? state.sellerProfile,
        brandingPolicy: action.payload.brandingPolicy ?? state.brandingPolicy,
        chatMessages: chatState.messages,
        chatLastSummary: chatState.lastSummary,
        chatCheckpoints: chatState.checkpoints,
        chatError: null,
        chatSending: false,
      };
    }
    case 'seller.patchProfile': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'seller.patchProfile',
        patch: action.patch,
      });
      return { ...state, ...doc };
    }
    case 'seller.patchBrand': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'seller.patchBrand',
        patch: action.patch,
      });
      return { ...state, ...doc };
    }
    case 'seller.setIntel':
      return {
        ...state,
        sellerProfile: { ...state.sellerProfile, website_intel: action.value },
      };
    case 'seller.setMeta':
      return {
        ...state,
        sellerProfile: { ...state.sellerProfile, ...action.patch },
      };
    case 'branding.setPolicy':
      return {
        ...state,
        brandingPolicy: normalizeFluxBrandingPolicy(action.value),
      };
    case 'campaign.setName':
      return { ...state, name: action.value };
    case 'campaign.setOfferDescription':
      return { ...state, offerDescription: action.value };
    case 'block.add': {
      const b = makeFluxDefaultBlock(action.blockType, state.blocks.length);
      return {
        ...state,
        blocks: [...state.blocks, { ...b, order: state.blocks.length }],
        editingBlockId: b.id,
      };
    }
    case 'block.remove': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'block.remove',
        blockId: action.blockId,
      });
      return { ...state, ...doc };
    }
    case 'block.updateProps': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'block.updateProps',
        blockId: action.blockId,
        props: action.props,
      });
      return { ...state, ...doc };
    }
    case 'block.setScrollTag': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'block.setScrollTag',
        blockId: action.blockId,
        scrollTag: action.scrollTag,
      });
      return { ...state, ...doc };
    }
    case 'block.setBlocks':
      return { ...state, blocks: action.blocks };
    case 'asset.add': {
      const doc = applyFluxEditorOperation(toDoc(state), { type: 'asset.add', asset: action.asset });
      return { ...state, ...doc };
    }
    case 'asset.remove': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'asset.remove',
        assetId: action.assetId,
      });
      return { ...state, ...doc };
    }
    case 'asset.update': {
      const doc = applyFluxEditorOperation(toDoc(state), {
        type: 'asset.update',
        assetId: action.assetId,
        patch: action.patch,
      });
      return { ...state, ...doc };
    }
    case 'template.setCopySlotsText':
      return { ...state, copySlots: action.value };
    case 'template.setConstraints':
      return { ...state, constraints: action.value };
    case 'preview.patchProspect':
      return {
        ...state,
        previewProspect: {
          ...state.previewProspect,
          ...action.patch,
          brand_profile:
            action.patch.brand_profile !== undefined
              ? action.patch.brand_profile
              : state.previewProspect.brand_profile,
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
            ...action.patch,
          },
        },
      };
    case 'preview.setProspect':
      return { ...state, previewProspect: action.value };
    case 'ui.setPreviewProspectOpen':
      return { ...state, previewProspectOpen: action.value };
    case 'ui.setEditingBlockId':
      return { ...state, editingBlockId: action.value };
    case 'ui.toggleEditingBlock':
      return {
        ...state,
        editingBlockId: state.editingBlockId === action.blockId ? null : action.blockId,
      };
    case 'chat.appendUser':
      return {
        ...state,
        chatMessages: [...state.chatMessages, { id: action.id, role: 'user', content: action.content }],
        chatCheckpoints: {
          ...state.chatCheckpoints,
          [action.id]: action.checkpoint,
        },
      };
    case 'chat.appendAssistant':
      return {
        ...state,
        chatMessages: [
          ...state.chatMessages,
          {
            id: action.id,
            role: 'assistant',
            content: action.content,
            summary: action.summary,
          },
        ],
        chatLastSummary: action.summary ?? null,
      };
    case 'chat.setSending':
      return { ...state, chatSending: action.value };
    case 'chat.setError':
      return { ...state, chatError: action.value };
    case 'chat.clearMessages':
      return {
        ...state,
        chatMessages: [],
        chatLastSummary: null,
        chatError: null,
        chatCheckpoints: {},
      };
    case 'chat.restore':
      return {
        ...state,
        chatMessages: action.value?.messages ?? [],
        chatLastSummary: action.value?.lastSummary ?? null,
        chatSending: false,
        chatError: null,
        chatCheckpoints: action.value?.checkpoints ?? {},
      };
    case 'chat.applyRemoteOperations': {
      let nextDoc = toDoc(state);
      for (const op of action.operations) {
        nextDoc = applyFluxEditorOperation(nextDoc, op);
      }
      return {
        ...state,
        ...nextDoc,
      };
    }
    case 'chat.rewindToCheckpoint': {
      const index = state.chatMessages.findIndex((message) => message.id === action.messageId);
      const checkpoint = state.chatCheckpoints[action.messageId];
      if (index < 0 || !checkpoint || state.chatMessages[index]?.role !== 'user') return state;
      const nextMessages = state.chatMessages.slice(0, index);
      const nextCheckpoints: Record<string, FluxEditorCheckpoint> = {};
      for (const message of nextMessages) {
        if (message.role !== 'user') continue;
        const existing = state.chatCheckpoints[message.id];
        if (existing) {
          nextCheckpoints[message.id] = existing;
        }
      }
      return {
        ...state,
        name: checkpoint.name,
        offerDescription: checkpoint.offerDescription,
        blocks: checkpoint.blocks,
        contentAssets: checkpoint.contentAssets,
        copySlots: checkpoint.copySlots,
        constraints: checkpoint.constraints,
        previewProspect: checkpoint.previewProspect,
        sellerProfile: checkpoint.sellerProfile,
        brandingPolicy: checkpoint.brandingPolicy,
        editingBlockId: checkpoint.editingBlockId,
        chatMessages: nextMessages,
        chatLastSummary: getLastFluxChatSummary(nextMessages),
        chatError: null,
        chatCheckpoints: nextCheckpoints,
      };
    }
    default:
      return state;
  }
}
