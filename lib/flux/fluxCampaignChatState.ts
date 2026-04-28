import type { Block, ContentAsset, FluxPreviewProspectInput, FluxSellerProfileInput } from './types';
import type { FluxBrandingPolicy } from './fluxBrandingPolicy';
import { defaultFluxBrandingPolicy, normalizeFluxBrandingPolicy } from './fluxBrandingPolicy';

function emptySellerProfile(): FluxSellerProfileInput {
  return {
    displayName: '',
    tagline: '',
    websiteUrl: '',
    brand_profile: null,
    website_intel: null,
    websiteDomainKey: null,
    foundryCompanyId: null,
    websiteIntelAutoFilledAt: null,
  };
}

export interface FluxCampaignChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  summary?: string[];
}

export interface FluxEditorCheckpoint {
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

export interface FluxCampaignChatState {
  messages: FluxCampaignChatMessage[];
  lastSummary: string[] | null;
  updatedAt: string | null;
  checkpoints: Record<string, FluxEditorCheckpoint>;
}

export function emptyFluxCampaignChatState(): FluxCampaignChatState {
  return {
    messages: [],
    lastSummary: null,
    updatedAt: null,
    checkpoints: {},
  };
}

export function getLastFluxChatSummary(messages: FluxCampaignChatMessage[]): string[] | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && Array.isArray(message.summary)) {
      return message.summary;
    }
  }
  return null;
}

function normalizeCheckpoint(raw: unknown): FluxEditorCheckpoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.name !== 'string' ||
    typeof entry.offerDescription !== 'string' ||
    !Array.isArray(entry.blocks) ||
    !Array.isArray(entry.contentAssets) ||
    typeof entry.copySlots !== 'string' ||
    typeof entry.constraints !== 'string' ||
    !entry.previewProspect ||
    typeof entry.previewProspect !== 'object' ||
    Array.isArray(entry.previewProspect) ||
    (entry.editingBlockId !== null && typeof entry.editingBlockId !== 'string')
  ) {
    return null;
  }
  const sellerProfile =
    entry.sellerProfile && typeof entry.sellerProfile === 'object' && !Array.isArray(entry.sellerProfile)
      ? (entry.sellerProfile as FluxSellerProfileInput)
      : emptySellerProfile();
  const brandingPolicy =
    entry.brandingPolicy !== undefined && entry.brandingPolicy !== null
      ? normalizeFluxBrandingPolicy(entry.brandingPolicy)
      : defaultFluxBrandingPolicy();
  return {
    name: entry.name,
    offerDescription: entry.offerDescription,
    blocks: entry.blocks as Block[],
    contentAssets: entry.contentAssets as ContentAsset[],
    copySlots: entry.copySlots,
    constraints: entry.constraints,
    previewProspect: entry.previewProspect as FluxPreviewProspectInput,
    sellerProfile,
    brandingPolicy,
    editingBlockId: entry.editingBlockId,
  };
}

function normalizeCheckpoints(raw: unknown): Record<string, FluxEditorCheckpoint> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const checkpoints: Record<string, FluxEditorCheckpoint> = {};
  for (const [messageId, value] of Object.entries(raw as Record<string, unknown>)) {
    const checkpoint = normalizeCheckpoint(value);
    if (checkpoint) {
      checkpoints[messageId] = checkpoint;
    }
  }
  return checkpoints;
}

export function normalizeFluxCampaignChatState(raw: unknown): FluxCampaignChatState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyFluxCampaignChatState();
  }
  const candidate = raw as {
    messages?: unknown;
    lastSummary?: unknown;
    updatedAt?: unknown;
    checkpoints?: unknown;
  };

  const messages = Array.isArray(candidate.messages)
    ? candidate.messages
        .map((message) => {
          if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
          const entry = message as Record<string, unknown>;
          if (
            typeof entry.id !== 'string' ||
            (entry.role !== 'user' && entry.role !== 'assistant') ||
            typeof entry.content !== 'string'
          ) {
            return null;
          }
          return {
            id: entry.id,
            role: entry.role,
            content: entry.content,
            ...(Array.isArray(entry.summary)
              ? {
                  summary: entry.summary.filter((line): line is string => typeof line === 'string'),
                }
              : {}),
          } satisfies FluxCampaignChatMessage;
        })
        .filter((message): message is FluxCampaignChatMessage => !!message)
    : [];

  return {
    messages,
    lastSummary: Array.isArray(candidate.lastSummary)
      ? candidate.lastSummary.filter((line): line is string => typeof line === 'string')
      : null,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
    checkpoints: normalizeCheckpoints(candidate.checkpoints),
  };
}
