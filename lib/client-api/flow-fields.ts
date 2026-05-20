import type { Json } from '../supabase/types/database';

type FlowNode = {
  type?: string | null;
  data?: Record<string, unknown> | null;
};

type FlowShape = {
  nodes?: FlowNode[];
};

function toFlowShape(flowData: Json | null | undefined): FlowShape {
  if (!flowData || typeof flowData !== 'object') {
    return {};
  }
  return flowData as unknown as FlowShape;
}

function getLeadSourceNodes(flowData: Json | null | undefined): FlowNode[] {
  return (toFlowShape(flowData).nodes ?? []).filter((node) => node?.type === 'leadSource');
}

export function getCampaignCustomFieldKeys(flowData: Json | null | undefined): string[] {
  const values = new Set<string>();
  for (const node of getLeadSourceNodes(flowData)) {
    const keys = node.data?.customFieldKeys;
    if (Array.isArray(keys)) {
      for (const key of keys) {
        if (typeof key === 'string' && key.trim()) values.add(key.trim());
      }
    }
  }
  return [...values];
}

export function getCampaignMappedStandardFieldKeys(flowData: Json | null | undefined): string[] {
  const values = new Set<string>();
  for (const node of getLeadSourceNodes(flowData)) {
    const keys = node.data?.mappedStandardFieldKeys;
    if (Array.isArray(keys)) {
      for (const key of keys) {
        if (typeof key === 'string' && key.trim()) values.add(key.trim());
      }
    }
  }
  return [...values];
}

export function appendCampaignCustomFieldKey(flowData: Json | null | undefined, key: string): Json {
  const trimmed = key.trim();
  const shape = toFlowShape(flowData);
  const nodes = [...(shape.nodes ?? [])];
  const leadSourceIndex = nodes.findIndex((node) => node?.type === 'leadSource');
  if (leadSourceIndex === -1) {
    return flowData as Json;
  }
  const node = nodes[leadSourceIndex] ?? {};
  const data = { ...(node.data ?? {}) };
  const existing = Array.isArray(data.customFieldKeys)
    ? data.customFieldKeys.filter((value): value is string => typeof value === 'string')
    : [];
  if (!existing.includes(trimmed)) {
    data.customFieldKeys = [...existing, trimmed];
  }
  nodes[leadSourceIndex] = {
    ...node,
    data,
  };
  return {
    ...shape,
    nodes,
  } as Json;
}
