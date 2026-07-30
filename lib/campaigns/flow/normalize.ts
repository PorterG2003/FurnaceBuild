import {
  canonicalizeEmailContentForSave,
  generateEmailVariantId,
  labelForVariantIndex,
  normalizeLegacyEmailNodeData,
  sortVariantsForRoundRobin,
} from '../../email/index.js';
import { backfillCategorizerEdgeHandles } from '../../categorizer/index.js';
import { normalizeCustomFieldKey } from '../../leads/csv-dedupe.js';
import {
  deriveEmailPriority,
  nodeIdsDownstreamOfCategorizer,
  pruneOrphanEdges,
} from './graphIntegrity.js';
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
import {
  inferDurationUnit,
  inferDurationValue,
  resolveWaitDurationSeconds,
} from './waitTime.js';

const UI_NODE_FIELDS = new Set([
  'selected',
  'dragging',
  'measured',
  'positionAbsolute',
  'resizing',
]);

const UI_EDGE_FIELDS = new Set(['selected']);

/** Builder-only lock/UX flags — must not persist or affect revision/conflict. */
const UI_NODE_DATA_FIELDS = new Set([
  'readOnly',
  'canDelete',
  'structuralBlocked',
]);

const UI_EDGE_DATA_FIELDS = new Set([
  'readOnly',
  'structuralBlocked',
]);

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

function stripBuilderUiNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  for (const key of UI_NODE_DATA_FIELDS) {
    delete copy[key];
  }
  return copy;
}

function stripBuilderUiEdgeData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const copy = { ...data };
  for (const key of UI_EDGE_DATA_FIELDS) {
    delete copy[key];
  }
  return Object.keys(copy).length > 0 ? copy : undefined;
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

/**
 * Like normalizeStringArray but preserves an unset field as `undefined` instead of
 * coercing to `[]`. This keeps "no explicit mapping" distinct from "explicitly empty",
 * so downstream sync logic does not treat an unset lead source as an empty allowlist.
 */
function normalizeOptionalStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  return normalizeStringArray(values);
}

function normalizeLeadSourceNodeData(rawData: Record<string, unknown>): LeadSourceNodeData {
  const mappedStandardFieldKeys = normalizeOptionalStringArray(rawData.mappedStandardFieldKeys);
  const { mappedStandardFieldKeys: _rawMapped, ...rest } = rawData;
  return {
    ...rest,
    label: asString(rawData.label, 'Lead Bucket'),
    source: asString(rawData.source, ''),
    bucketId: asString(rawData.bucketId),
    customFieldKeys: normalizeStringArray(rawData.customFieldKeys),
    ...(mappedStandardFieldKeys !== undefined ? { mappedStandardFieldKeys } : {}),
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
  // Seed from explicit priority or legacy send_mode; final value is recomputed
  // positionally in applyDerivedEmailPriority.
  const prioritySeed =
    rawData.priority === true
    || legacyFields.priority === true
    || rawData.send_mode === 'reply'
    || legacyFields.send_mode === 'reply';

  const { send_mode: _legacySendMode, ...restLegacy } = legacyFields as Record<string, unknown> & {
    send_mode?: unknown;
  };
  void _legacySendMode;

  return {
    ...restLegacy,
    label: asString(rawData.label || legacyFields.label, 'Send Email'),
    mailboxId,
    priority: prioritySeed,
    variants: canonicalVariants,
  };
}

function normalizeWaitTimeNodeData(rawData: Record<string, unknown>): WaitTimeNodeData {
  const waitDurationSeconds = resolveWaitDurationSeconds({
    wait_duration_seconds: rawData.wait_duration_seconds,
    duration: rawData.duration,
    unit: rawData.unit,
  });
  const displayUnit = inferDurationUnit(waitDurationSeconds);
  const displayDuration = inferDurationValue(waitDurationSeconds, displayUnit);

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
  const data = stripBuilderUiNodeData(normalizeNodeData(type, asRecord(node.data)));
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
  const { data: rawData, ...rest } = edge;
  const data = stripBuilderUiEdgeData(
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? asRecord(rawData)
      : undefined,
  );
  return {
    ...(rest as Record<string, unknown>),
    id: asString(edge.id),
    source: asString(edge.source),
    target: asString(edge.target),
    sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : edge.sourceHandle === null ? null : undefined,
    targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : edge.targetHandle === null ? null : undefined,
    ...(typeof edge.type === 'string' ? { type: edge.type } : {}),
    ...(data ? { data } : {}),
  } as CampaignFlowEdge;
}

/**
 * Apply the derived priority marker (see deriveEmailPriority) to every email
 * node. Priority is positional — downstream of a categorizer — so a priority
 * email can never be stranded before a categorizer. Also strips legacy
 * send_mode from persisted node data.
 */
function applyDerivedEmailPriority(
  nodes: CampaignFlowNode[],
  edges: CampaignFlowEdge[],
): CampaignFlowNode[] {
  const downstream = nodeIdsDownstreamOfCategorizer(nodes, edges);
  return nodes.map((node) => {
    if (node.type !== 'email') return node;
    const desired = deriveEmailPriority(node, downstream);
    const data = node.data as EmailNodeData & { send_mode?: unknown };
    const { send_mode: _legacy, ...rest } = data;
    void _legacy;
    if (data.priority === desired && !('send_mode' in data)) return node;
    return { ...node, data: { ...rest, priority: desired } } as CampaignFlowNode;
  });
}

export function normalizeFlowData(rawFlowData: unknown): CampaignFlowData {
  const flow = asRecord(rawFlowData);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.map(normalizeFlowNode) : [];
  const mappedEdges = Array.isArray(flow.edges) ? flow.edges.map(normalizeFlowEdge) : [];
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  const edges = backfillCategorizerEdgeHandles(pruneOrphanEdges(mappedEdges, nodeIds), nodes);

  return {
    nodes: applyDerivedEmailPriority(nodes, edges),
    edges,
  };
}
