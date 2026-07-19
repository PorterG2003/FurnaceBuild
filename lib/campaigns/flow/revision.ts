import { sha256Hex } from '../../utils/sha256Hex.js';
import type { CampaignFlowData, CampaignFlowEdge, CampaignFlowNode } from './types';

const UI_NODE_FIELDS = new Set([
  'selected',
  'dragging',
  'measured',
  'positionAbsolute',
  'resizing',
  'position',
]);

const UI_EDGE_FIELDS = new Set(['selected']);

const UI_NODE_DATA_FIELDS = new Set([
  'readOnly',
  'canDelete',
  'structuralBlocked',
]);

const UI_EDGE_DATA_FIELDS = new Set([
  'readOnly',
  'structuralBlocked',
]);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

function stripUiFieldsFromNode(node: CampaignFlowNode): Record<string, unknown> {
  const copy = { ...(node as unknown as Record<string, unknown>) };
  for (const key of UI_NODE_FIELDS) {
    delete copy[key];
  }
  if (copy.data && typeof copy.data === 'object' && !Array.isArray(copy.data)) {
    const data = { ...(copy.data as Record<string, unknown>) };
    for (const key of UI_NODE_DATA_FIELDS) {
      delete data[key];
    }
    copy.data = data;
  }
  return copy;
}

function stripUiFieldsFromEdge(edge: CampaignFlowEdge): Record<string, unknown> {
  const copy = { ...(edge as unknown as Record<string, unknown>) };
  for (const key of UI_EDGE_FIELDS) {
    delete copy[key];
  }
  if (copy.data && typeof copy.data === 'object' && !Array.isArray(copy.data)) {
    const data = { ...(copy.data as Record<string, unknown>) };
    for (const key of UI_EDGE_DATA_FIELDS) {
      delete data[key];
    }
    copy.data = Object.keys(data).length > 0 ? data : undefined;
    if (copy.data === undefined) delete copy.data;
  }
  return copy;
}

export function canonicalizeFlowForRevision(flowData: CampaignFlowData): CampaignFlowData {
  return {
    nodes: flowData.nodes.map((node) => stripUiFieldsFromNode(node) as CampaignFlowNode),
    edges: flowData.edges.map((edge) => stripUiFieldsFromEdge(edge) as CampaignFlowEdge),
  };
}

export async function computeFlowRevision(flowData: CampaignFlowData): Promise<string> {
  const canonical = canonicalizeFlowForRevision(flowData);
  const payload = JSON.stringify(sortKeys(canonical));
  return sha256Hex(payload);
}

/**
 * Deterministic serialization for local dirty-checking. Deep-sorts object keys so
 * the string is stable across a Postgres jsonb round-trip (which reorders keys),
 * while keeping every normalized field (including `position`) so genuine edits
 * still register as changes.
 */
export function stableSerializeFlow(flowData: CampaignFlowData): string {
  return JSON.stringify(sortKeys(flowData));
}

export class FlowRevisionConflictError extends Error {
  readonly code = 'flow_revision_conflict' as const;
  readonly currentFlowRevision: string;

  constructor(currentFlowRevision: string, message = 'Flow revision conflict') {
    super(message);
    this.name = 'FlowRevisionConflictError';
    this.currentFlowRevision = currentFlowRevision;
  }
}

export function assertFlowRevision(
  ifMatch: string | null | undefined,
  currentRevision: string,
): void {
  if (!ifMatch || !ifMatch.trim()) return;
  if (ifMatch.trim() !== currentRevision) {
    throw new FlowRevisionConflictError(currentRevision);
  }
}
