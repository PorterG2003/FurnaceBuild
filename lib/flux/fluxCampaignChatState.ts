export interface FluxCampaignChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  summary?: string[];
}

export interface FluxCampaignChatState {
  messages: FluxCampaignChatMessage[];
  lastSummary: string[] | null;
  updatedAt: string | null;
}

export function emptyFluxCampaignChatState(): FluxCampaignChatState {
  return {
    messages: [],
    lastSummary: null,
    updatedAt: null,
  };
}

export function normalizeFluxCampaignChatState(raw: unknown): FluxCampaignChatState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyFluxCampaignChatState();
  }
  const candidate = raw as {
    messages?: unknown;
    lastSummary?: unknown;
    updatedAt?: unknown;
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
  };
}
