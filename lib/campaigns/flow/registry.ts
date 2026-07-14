import type { FlowNodeType } from './types';

export type FlowNodeRegistryEntry = {
  type: FlowNodeType;
  label: string;
  description: string;
  maxPerFlow?: number;
  liveContentPatchAllowed: boolean;
};

export const FLOW_NODE_REGISTRY: Record<FlowNodeType, FlowNodeRegistryEntry> = {
  leadSource: {
    type: 'leadSource',
    label: 'Lead Source',
    description: 'Entry point for leads entering the campaign flow.',
    maxPerFlow: 1,
    liveContentPatchAllowed: true,
  },
  email: {
    type: 'email',
    label: 'Email',
    description: 'Send email with one or more variants.',
    liveContentPatchAllowed: true,
  },
  waitTime: {
    type: 'waitTime',
    label: 'Wait',
    description: 'Delay before the next step.',
    liveContentPatchAllowed: true,
  },
  aiCategorizer: {
    type: 'aiCategorizer',
    label: 'AI Categorizer',
    description: 'Route replies by AI category.',
    maxPerFlow: 1,
    liveContentPatchAllowed: true,
  },
  dataSender: {
    type: 'dataSender',
    label: 'Data Sender',
    description: 'POST lead data to a webhook endpoint.',
    liveContentPatchAllowed: true,
  },
};

export function getFlowNodeRegistryEntry(type: FlowNodeType): FlowNodeRegistryEntry {
  return FLOW_NODE_REGISTRY[type];
}

export function isLiveContentPatchAllowed(type: FlowNodeType): boolean {
  return FLOW_NODE_REGISTRY[type].liveContentPatchAllowed;
}
