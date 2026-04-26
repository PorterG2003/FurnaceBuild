import type { Block, ContentAsset, FluxPreviewProspectInput } from '@/lib/flux/types';
import { applyFluxEditorOperation, type FluxEditorDocumentState } from '@/lib/flux/editor/applyOperations';
import type { FluxEditorOperation } from '@/lib/flux/editor/schemas';
import { makeFluxDefaultBlock } from '@/lib/flux/defaultCampaignTemplate';
import type { FluxCampaignChatMessage, FluxCampaignChatState } from '@/lib/flux/fluxCampaignChatState';
export type FluxChatMessage = FluxCampaignChatMessage;

export interface FluxEditorUndoSnapshot {
  name: string;
  offerDescription: string;
  blocks: Block[];
  contentAssets: ContentAsset[];
  copySlots: string;
  constraints: string;
  previewProspect: FluxPreviewProspectInput;
  editingBlockId: string | null;
}

export interface FluxCampaignEditorState extends FluxEditorDocumentState {
  previewProspectOpen: boolean;
  chatMessages: FluxChatMessage[];
  chatSending: boolean;
  chatError: string | null;
  chatLastSummary: string[] | null;
  /** Snapshot before the last chat-applied operation batch (for one-step undo). */
  chatUndoSnapshot: FluxEditorUndoSnapshot | null;
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
      };
    }
  | { type: 'campaign.setName'; value: string }
  | { type: 'campaign.setOfferDescription'; value: string }
  | { type: 'block.add'; blockType: Block['type']; index?: number }
  | { type: 'block.remove'; blockId: string }
  | { type: 'block.updateProps'; blockId: string; props: Record<string, unknown> }
  | { type: 'block.setBlocks'; blocks: Block[] }
  | { type: 'asset.add'; asset: ContentAsset }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'template.setCopySlotsText'; value: string }
  | { type: 'template.setConstraints'; value: string }
  | { type: 'preview.patchProspect'; patch: Partial<FluxPreviewProspectInput> }
  | {
      type: 'preview.patchBrand';
      patch: { primaryColor?: string; accentColor?: string; fontFamily?: string; logoUrl?: string };
    }
  | { type: 'preview.setProspect'; value: FluxPreviewProspectInput }
  | { type: 'ui.setPreviewProspectOpen'; value: boolean }
  | { type: 'ui.setEditingBlockId'; value: string | null }
  | { type: 'ui.toggleEditingBlock'; blockId: string }
  | { type: 'chat.appendUser'; id: string; content: string }
  | { type: 'chat.appendAssistant'; id: string; content: string; summary?: string[] }
  | { type: 'chat.setSending'; value: boolean }
  | { type: 'chat.setError'; value: string | null }
  | { type: 'chat.clearMessages' }
  | { type: 'chat.restore'; value: FluxCampaignChatState | null }
  | { type: 'chat.applyRemoteOperations'; operations: FluxEditorOperation[] }
  | { type: 'chat.undoLast' };

function toDoc(s: FluxCampaignEditorState): FluxEditorDocumentState {
  const {
    previewProspectOpen: _o,
    chatMessages: _m,
    chatSending: _s,
    chatError: _e,
    chatLastSummary: _l,
    chatUndoSnapshot: _u,
    ...doc
  } = s;
  return doc;
}

function snapshotFromState(s: FluxCampaignEditorState): FluxEditorUndoSnapshot {
  return {
    name: s.name,
    offerDescription: s.offerDescription,
    blocks: JSON.parse(JSON.stringify(s.blocks)) as Block[],
    contentAssets: JSON.parse(JSON.stringify(s.contentAssets)) as ContentAsset[],
    copySlots: s.copySlots,
    constraints: s.constraints,
    previewProspect: JSON.parse(JSON.stringify(s.previewProspect)) as FluxPreviewProspectInput,
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
    previewProspectOpen: true,
    editingBlockId: null,
    chatMessages: [],
    chatSending: false,
    chatError: null,
    chatLastSummary: null,
    chatUndoSnapshot: null,
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
        chatMessages: chatState.messages,
        chatLastSummary: chatState.lastSummary,
        chatUndoSnapshot: null,
        chatError: null,
        chatSending: false,
      };
    }
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
        chatUndoSnapshot: null,
      };
    case 'chat.restore':
      return {
        ...state,
        chatMessages: action.value?.messages ?? [],
        chatLastSummary: action.value?.lastSummary ?? null,
        chatSending: false,
        chatError: null,
        chatUndoSnapshot: null,
      };
    case 'chat.applyRemoteOperations': {
      const snap = snapshotFromState(state);
      let nextDoc = toDoc(state);
      for (const op of action.operations) {
        nextDoc = applyFluxEditorOperation(nextDoc, op);
      }
      return {
        ...state,
        ...nextDoc,
        chatUndoSnapshot: snap,
      };
    }
    case 'chat.undoLast': {
      if (!state.chatUndoSnapshot) return state;
      const u = state.chatUndoSnapshot;
      return {
        ...state,
        name: u.name,
        offerDescription: u.offerDescription,
        blocks: u.blocks,
        contentAssets: u.contentAssets,
        copySlots: u.copySlots,
        constraints: u.constraints,
        previewProspect: u.previewProspect,
        editingBlockId: u.editingBlockId,
        chatUndoSnapshot: null,
      };
    }
    default:
      return state;
  }
}
