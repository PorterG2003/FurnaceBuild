import type { PageConfig } from '@/lib/flux/types';
import type { FluxCampaignChatMessage } from '@/lib/flux/fluxCampaignChatState';

export interface FluxProspectPageChatCheckpoint {
  pageConfig: PageConfig;
  editingBlockId: string | null;
}

export interface FluxProspectPageChatState {
  messages: FluxCampaignChatMessage[];
  lastSummary: string[] | null;
  updatedAt: string | null;
  checkpoints: Record<string, FluxProspectPageChatCheckpoint>;
}

export function emptyFluxProspectPageChatState(): FluxProspectPageChatState {
  return {
    messages: [],
    lastSummary: null,
    updatedAt: null,
    checkpoints: {},
  };
}

function normalizeProspectCheckpoint(raw: unknown): FluxProspectPageChatCheckpoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (!entry.pageConfig || typeof entry.pageConfig !== 'object' || Array.isArray(entry.pageConfig)) {
    return null;
  }
  if (entry.editingBlockId !== null && typeof entry.editingBlockId !== 'string') return null;
  return {
    pageConfig: entry.pageConfig as PageConfig,
    editingBlockId: entry.editingBlockId as string | null,
  };
}

function normalizeProspectCheckpoints(raw: unknown): Record<string, FluxProspectPageChatCheckpoint> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, FluxProspectPageChatCheckpoint> = {};
  for (const [messageId, value] of Object.entries(raw as Record<string, unknown>)) {
    const cp = normalizeProspectCheckpoint(value);
    if (cp) out[messageId] = cp;
  }
  return out;
}

export function normalizeFluxProspectPageChatState(raw: unknown): FluxProspectPageChatState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyFluxProspectPageChatState();
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
    checkpoints: normalizeProspectCheckpoints(candidate.checkpoints),
  };
}
