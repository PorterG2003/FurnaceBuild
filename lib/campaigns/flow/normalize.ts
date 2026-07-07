import {
  canonicalizeEmailContentForSave,
  generateEmailVariantId,
  labelForVariantIndex,
  normalizeLegacyEmailNodeData,
  sortVariantsForRoundRobin,
} from '../../email/index.js';
import { backfillCategorizerEdgeHandles } from '../../categorizer/index.js';
import { normalizeCustomFieldKey } from '../../leads/csv-dedupe.js';
import type {
  AICategorizerNodeData,
  CampaignFlowData,
  CampaignFlowEdge,
  CampaignFlowNode,
  DataSenderNodeData,
  EmailNodeData,
  FlowNodeType,
  FlowPosition,
  LeadSourceNodeData,
  WaitTimeNodeData,
} from './types';

const UI_NODE_FIELDS = new Set([
  'selected',
  'dragging',
  'measured',
  'positionAbsolute',
  'resizing',
]);

const UI_EDGE_FIELDS = new Set(['selected']);

const UNIT_TO_SECONDS: Record<string, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asPosition(value: unknown): FlowPosition {
  const record = asRecord(value);
  const x = typeof record.x === 'number' && Number.isFinite(record.x) ? record.x : 0;
  const y = typeof record.y === 'number' && Number.isFinite(record.y) ? record.y : 0;
  return { x, y };
}

function sanitizeNodeShell(rawNode: unknown): Record<string, unknown> {
  const node = asRecord(rawNode);
  for (const key of UI_NODE_FIELDS) {
    delete node[key];
  }
  return node;
}

function sanitizeEdgeShell(rawEdge: unknown): Record<string, unknown> {
  const edge = asRecord(rawEdge);
  for (const key of UI_EDGE_FIELDS) {
    delete edge[key];
  }
  if (edge.type === 'deletable') {
    delete edge.type;
  }
  return edge;
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = normalizeCustomFieldKey(value);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function inferDurationUnit(waitDurationSeconds: number): 'minutes' | 'hours' | 'days' {
  if (waitDurationSeconds % UNIT_TO_SECONDS.days === 0) return 'days';
  if (waitDurationSeconds % UNIT_TO_SECONDS.hours === 0) return 'hours';
  return 'minutes';
}

function inferDurationValue(waitDurationSeconds: number, unit: 'minutes' | 'hours' | 'days'): string {
  return String(Math.max(1, Math.floor(waitDurationSeconds / UNIT_TO_SECONDS[unit])));
}

function normalizeLeadSourceNodeData(rawData: Record<string, unknown>): LeadSourceNodeData {
  return {
    ...rawData,
    label: asString(rawData.label, 'Lead Bucket'),
    source: asString(rawData.source, ''),
    bucketId: asString(rawData.bucketId),
    customFieldKeys: normalizeStringArray(rawData.customFieldKeys),
    mappedStandardFieldKeys: normalizeStringArray(rawData.mappedStandardFieldKeys),
    isRequired: asBoolean(rawData.isRequired, false),
  };
}

function normalizeEmailNodeData(rawData: Record<string, unknown>): EmailNodeData {
  const { variants, legacyFields } = normalizeLegacyEmailNodeData(rawData);
  const canonicalVariants = sortVariantsForRoundRobin(
    variants.map((variant, index) => {
      const canonical = canonicalizeEmailContentForSave({
        editorMode: variant.editor_mode,
        bodyHtml: variant.body_html,
        bodyText: variant.body_text,
        template: variant.template,
      });
      return {
        ...variant,
        id: variant.id?.trim() || generateEmailVariantId(),
        label: labelForVariantIndex(index),
        subject: String(variant.subject ?? ''),
        template: canonical.template,
        body_html: canonical.bodyHtml,
        body_text: canonical.bodyText,
        editor_mode: canonical.editorMode,
        isActive: variant.isActive !== false,
        order: index,
      };
    }),
  ).map((variant, index) => ({
    ...variant,
    label: labelForVariantIndex(index),
    order: index,
  }));

  const mailboxId = asString(rawData.mailboxId || legacyFields.mailboxId, '');
  const sendMode = rawData.send_mode === 'reply' || legacyFields.send_mode === 'reply'
    ? 'reply'
    : 'new';

  return {
    ...legacyFields,
    label: asString(rawData.label || legacyFields.label, 'Send Email'),
    mailboxId,
    send_mode: sendMode,
    variants: canonicalVariants,
  };
}

function normalizeWaitTimeNodeData(rawData: Record<string, unknown>): WaitTimeNodeData {
  const unit = rawData.unit === 'minutes' || rawData.unit === 'hours' || rawData.unit === 'days'
    ? rawData.unit
    : 'hours';
  const duration = asString(rawData.duration);
  const explicitSeconds =
    typeof rawData.wait_duration_seconds === 'number' && Number.isFinite(rawData.wait_duration_seconds)
      ? Math.max(0, Math.floor(rawData.wait_duration_seconds))
      : 0;
  const computedSeconds =
    duration.trim().length > 0
      ? Math.max(0, Math.floor(Number.parseInt(duration.trim(), 10) || 0) * UNIT_TO_SECONDS[unit])
      : 0;
  const waitDurationSeconds = explicitSeconds > 0 ? explicitSeconds : computedSeconds;
  const displayUnit = waitDurationSeconds > 0 ? inferDurationUnit(waitDurationSeconds) : unit;
  const displayDuration = waitDurationSeconds > 0
    ? inferDurationValue(waitDurationSeconds, displayUnit)
    : duration;

  return {
    ...rawData,
    label: asString(rawData.label, 'Wait Time'),
    duration: displayDuration,
    unit: displayUnit,
    wait_duration_seconds: waitDurationSeconds,
  };
}

function normalizeAICategorizerNodeData(rawData: Record<string, unknown>): AICategorizerNodeData {
  return {
    ...rawData,
    label: asString(rawData.label, 'Categorizer'),
    use_ai: asBoolean(rawData.use_ai, false),
  };
}

function normalizeDataSenderNodeData(rawData: Record<string, unknown>): DataSenderNodeData {
  const endpoint = asString(rawData.endpoint_url || rawData.endpoint, '');
  const payloadTemplate =
    rawData.payload_template && typeof rawData.payload_template === 'object' && !Array.isArray(rawData.payload_template)
      ? { ...(rawData.payload_template as Record<string, unknown>) }
      : null;
  const payload = typeof rawData.payload === 'string' && rawData.payload.trim().length > 0
    ? rawData.payload
    : payloadTemplate
      ? JSON.stringify(payloadTemplate, null, 2)
      : '';

  return {
    ...rawData,
    label: asString(rawData.label, 'Data Sender'),
    endpoint,
    endpoint_url: endpoint,
    payload,
    payload_template: payloadTemplate ?? {},
    on_failure: rawData.on_failure === 'stop' ? 'stop' : 'continue',
  };
}

function normalizeNodeData(type: string, rawData: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'leadSource':
      return normalizeLeadSourceNodeData(rawData);
    case 'email':
      return normalizeEmailNodeData(rawData);
    case 'waitTime':
      return normalizeWaitTimeNodeData(rawData);
    case 'aiCategorizer':
      return normalizeAICategorizerNodeData(rawData);
    case 'dataSender':
      return normalizeDataSenderNodeData(rawData);
    default:
      return rawData;
  }
}

export function normalizeFlowNode(rawNode: unknown): CampaignFlowNode {
  const node = sanitizeNodeShell(rawNode);
  const type = asString(node.type) as FlowNodeType;
  const data = normalizeNodeData(type, asRecord(node.data));
  const normalized: CampaignFlowNode = {
    ...(node as Record<string, unknown>),
    id: asString(node.id),
    type,
    position: asPosition(node.position),
    data,
  } as CampaignFlowNode;

  if (type === 'leadSource' || (data as LeadSourceNodeData).isRequired) {
    normalized.deletable = false;
  } else if ('deletable' in node) {
    normalized.deletable = Boolean(node.deletable);
  }

  return normalized;
}

export function normalizeFlowEdge(rawEdge: unknown): CampaignFlowEdge {
  const edge = sanitizeEdgeShell(rawEdge);
  return {
    ...(edge as Record<string, unknown>),
    id: asString(edge.id),
    source: asString(edge.source),
    target: asString(edge.target),
    sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : edge.sourceHandle === null ? null : undefined,
    targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : edge.targetHandle === null ? null : undefined,
    ...(typeof edge.type === 'string' ? { type: edge.type } : {}),
  } as CampaignFlowEdge;
}

export function normalizeFlowData(rawFlowData: unknown): CampaignFlowData {
  const flow = asRecord(rawFlowData);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.map(normalizeFlowNode) : [];
  const edges = Array.isArray(flow.edges) ? flow.edges.map(normalizeFlowEdge) : [];

  return {
    nodes,
    edges: backfillCategorizerEdgeHandles(edges, nodes),
  };
}
