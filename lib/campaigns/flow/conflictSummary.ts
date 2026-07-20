import { stripHtml } from '../../email/parse-body.js';
import type { EmailNodeVariant } from '../../email/emailNodeVariants.js';
import { FLOW_NODE_REGISTRY } from './registry.js';
import type {
  AICategorizerFlowNode,
  CampaignFlowData,
  CampaignFlowNode,
  DataSenderFlowNode,
  EmailFlowNode,
  LeadSourceFlowNode,
  WaitTimeFlowNode,
} from './types.js';

export type FlowConflictFieldChange = {
  label: string;
  yours: string | null;
  saved: string | null;
};

export type FlowConflictNodeDiff = {
  nodeId: string;
  title: string;
  typeLabel: string;
  kind: 'added' | 'removed' | 'modified';
  fields: FlowConflictFieldChange[];
  detail?: string;
};

export type FlowPreviewStep = {
  nodeId: string;
  title: string;
  typeLabel: string;
  detail?: string;
  isChanged: boolean;
};

export type FlowConflictSummary = {
  yoursSteps: FlowPreviewStep[];
  savedSteps: FlowPreviewStep[];
  nodeDiffs: FlowConflictNodeDiff[];
  sequenceSummary?: string;
};

const UI_NODE_DATA_FIELDS = new Set([
  'selected',
  'dragging',
  'measured',
  'positionAbsolute',
  'resizing',
  'readOnly',
  'canDelete',
  'structuralBlocked',
]);

const DERIVED_NODE_DATA_FIELDS = new Set([
  'wait_duration_seconds',
]);

function edgeSignature(edge: {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}): string {
  return [
    edge.source,
    edge.sourceHandle ?? '',
    edge.target,
    edge.targetHandle ?? '',
  ].join('::');
}

function normalizeDisplayText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function formatFieldList(keys: string[] | undefined): string {
  const sorted = [...(keys ?? [])].sort();
  return sorted.length > 0 ? sorted.join(', ') : '(none)';
}

function formatJsonPayload(payload: string | undefined): string {
  const trimmed = payload?.trim();
  if (!trimmed) return '(empty)';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function formatSendMode(mode: string | undefined): string {
  if (mode === 'reply') return 'Reply';
  if (mode === 'new') return 'New thread';
  return mode?.trim() || '(empty)';
}

function formatOnFailure(value: string | undefined): string {
  if (value === 'stop') return 'Stop campaign';
  if (value === 'continue') return 'Continue';
  return value?.trim() || '(empty)';
}

function formatAiRouting(enabled: boolean | undefined): string {
  return enabled === false ? 'Disabled' : 'Enabled';
}

function getStepTitle(node: CampaignFlowNode): string {
  const customLabel = typeof node.data.label === 'string' ? node.data.label.trim() : '';
  if (customLabel) return customLabel;
  return FLOW_NODE_REGISTRY[node.type].label;
}

function getTypeLabel(node: CampaignFlowNode): string {
  return FLOW_NODE_REGISTRY[node.type].label;
}

function formatWaitDuration(duration: string, unit: string): string {
  const count = Number(duration);
  if (!Number.isFinite(count)) return `${duration} ${unit}`;
  if (unit === 'days') return count === 1 ? '1 day' : `${count} days`;
  if (unit === 'hours') return count === 1 ? '1 hour' : `${count} hours`;
  if (unit === 'minutes') return count === 1 ? '1 minute' : `${count} minutes`;
  return `${duration} ${unit}`;
}

function getActiveEmailVariant(node: EmailFlowNode) {
  const variants = Array.isArray(node.data.variants) ? node.data.variants : [];
  return variants.find((variant) => variant.isActive !== false) ?? variants[0];
}

function getEmailSubject(node: EmailFlowNode): string {
  const active = getActiveEmailVariant(node);
  return active?.subject?.trim() || node.data.subject?.trim() || '';
}

function getEmailBodyText(node: EmailFlowNode): string {
  const active = getActiveEmailVariant(node);
  const fromVariant = active?.template?.trim()
    || active?.body_text?.trim()
    || (active?.body_html ? stripHtml(active.body_html) : '');
  const fromNode = node.data.template?.trim()
    || node.data.body_text?.trim()
    || (node.data.body_html ? stripHtml(node.data.body_html) : '');
  return normalizeDisplayText(fromVariant || fromNode || '');
}

function getSortedVariants(node: EmailFlowNode): EmailNodeVariant[] {
  const variants = Array.isArray(node.data.variants) ? node.data.variants : [];
  return [...variants].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function getVariantLabel(variant: EmailNodeVariant, index: number): string {
  return variant.label?.trim() || String.fromCharCode(65 + index);
}

function variantFieldLabel(variantLabel: string, field: string): string {
  return `Variant ${variantLabel} · ${field}`;
}

function getVariantSubject(variant: EmailNodeVariant): string {
  return variant.subject?.trim() || '(empty)';
}

function getVariantBodyText(variant: EmailNodeVariant): string {
  const text = variant.template?.trim()
    || variant.body_text?.trim()
    || (variant.body_html ? stripHtml(variant.body_html) : '');
  return normalizeDisplayText(text) || '(empty)';
}

function formatVariantActive(variant: EmailNodeVariant): string {
  return variant.isActive === false ? 'Disabled' : 'Enabled';
}

function isMultiVariantEmailNode(node: EmailFlowNode): boolean {
  return getSortedVariants(node).length > 1;
}

function isMultiVariantEmail(localNode: EmailFlowNode, savedNode: EmailFlowNode): boolean {
  const localVariants = getSortedVariants(localNode);
  const savedVariants = getSortedVariants(savedNode);
  if (localVariants.length > 1 || savedVariants.length > 1) return true;

  const localIds = new Set(localVariants.map((variant) => variant.id));
  const savedIds = new Set(savedVariants.map((variant) => variant.id));
  if (localIds.size !== savedIds.size) return true;
  for (const id of localIds) {
    if (!savedIds.has(id)) return true;
  }
  return false;
}

function pairVariantsById(
  localVariants: EmailNodeVariant[],
  savedVariants: EmailNodeVariant[],
): {
  paired: Array<{ local: EmailNodeVariant; saved: EmailNodeVariant }>;
  localOnly: EmailNodeVariant[];
  savedOnly: EmailNodeVariant[];
} {
  const savedById = new Map(savedVariants.map((variant) => [variant.id, variant] as const));
  const localById = new Map(localVariants.map((variant) => [variant.id, variant] as const));
  const paired: Array<{ local: EmailNodeVariant; saved: EmailNodeVariant }> = [];
  const localOnly: EmailNodeVariant[] = [];
  const savedOnly: EmailNodeVariant[] = [];

  for (const local of localVariants) {
    const saved = savedById.get(local.id);
    if (saved) paired.push({ local, saved });
    else localOnly.push(local);
  }

  for (const saved of savedVariants) {
    if (!localById.has(saved.id)) savedOnly.push(saved);
  }

  return { paired, localOnly, savedOnly };
}

function pushVariantSnapshotFields(
  fields: FlowConflictFieldChange[],
  variant: EmailNodeVariant,
  index: number,
  side: 'yours' | 'saved',
): void {
  const label = getVariantLabel(variant, index);
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);

  fields.push({
    label: variantFieldLabel(label, 'Subject'),
    yours: value(getVariantSubject(variant)),
    saved: other(getVariantSubject(variant)),
  });
  fields.push({
    label: variantFieldLabel(label, 'Email body'),
    yours: value(getVariantBodyText(variant)),
    saved: other(getVariantBodyText(variant)),
  });
}

function buildPerVariantEmailFieldChanges(
  localNode: EmailFlowNode,
  savedNode: EmailFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [];
  const localVariants = getSortedVariants(localNode);
  const savedVariants = getSortedVariants(savedNode);
  const { paired, localOnly, savedOnly } = pairVariantsById(localVariants, savedVariants);

  for (const { local, saved } of paired) {
    const localIndex = localVariants.findIndex((variant) => variant.id === local.id);
    const label = getVariantLabel(local, localIndex >= 0 ? localIndex : 0);
    pushFieldIfDifferent(
      fields,
      variantFieldLabel(label, 'Subject'),
      getVariantSubject(local),
      getVariantSubject(saved),
    );
    pushFieldIfDifferent(
      fields,
      variantFieldLabel(label, 'Email body'),
      getVariantBodyText(local),
      getVariantBodyText(saved),
    );
    pushFieldIfDifferent(
      fields,
      variantFieldLabel(label, 'Active'),
      formatVariantActive(local),
      formatVariantActive(saved),
    );
  }

  for (let index = 0; index < localOnly.length; index++) {
    const variant = localOnly[index]!;
    const variantIndex = localVariants.findIndex((entry) => entry.id === variant.id);
    pushVariantSnapshotFields(fields, variant, variantIndex >= 0 ? variantIndex : index, 'yours');
  }

  for (let index = 0; index < savedOnly.length; index++) {
    const variant = savedOnly[index]!;
    const variantIndex = savedVariants.findIndex((entry) => entry.id === variant.id);
    pushVariantSnapshotFields(fields, variant, variantIndex >= 0 ? variantIndex : index, 'saved');
  }

  return fields;
}

function buildSharedEmailNodeFields(
  localNode: EmailFlowNode,
  savedNode: EmailFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [...buildStepNameField(localNode, savedNode)];
  pushFieldIfDifferent(
    fields,
    'Send mode',
    formatSendMode(localNode.data.send_mode),
    formatSendMode(savedNode.data.send_mode),
  );
  pushFieldIfDifferent(
    fields,
    'Mailbox',
    localNode.data.mailboxId?.trim() || '(none)',
    savedNode.data.mailboxId?.trim() || '(none)',
  );
  return fields;
}

function getStepDetail(node: CampaignFlowNode): string | undefined {
  switch (node.type) {
    case 'email': {
      const subject = getEmailSubject(node);
      return subject || undefined;
    }
    case 'waitTime': {
      const duration = node.data.duration?.trim();
      const unit = node.data.unit;
      if (duration && unit) return formatWaitDuration(duration, unit);
      return undefined;
    }
    case 'leadSource': {
      const customCount = node.data.customFieldKeys?.length ?? 0;
      const standardCount = node.data.mappedStandardFieldKeys?.length ?? 0;
      const total = customCount + standardCount;
      if (total === 0) return undefined;
      return total === 1 ? '1 lead field' : `${total} lead fields`;
    }
    case 'dataSender': {
      const endpoint = node.data.endpoint_url ?? node.data.endpoint;
      if (typeof endpoint === 'string' && endpoint.trim()) return endpoint.trim();
      return undefined;
    }
    default:
      return undefined;
  }
}

function stripNoiseFromNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  for (const key of UI_NODE_DATA_FIELDS) {
    delete copy[key];
  }
  for (const key of DERIVED_NODE_DATA_FIELDS) {
    delete copy[key];
  }
  return copy;
}

function formatDataValue(value: unknown): string {
  if (value == null) return '(empty)';
  if (typeof value === 'string') return normalizeDisplayText(value) || '(empty)';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return normalizeDisplayText(JSON.stringify(value, null, 2));
}

function pushFieldIfDifferent(
  fields: FlowConflictFieldChange[],
  label: string,
  yours: string,
  saved: string,
): void {
  if (yours !== saved) {
    fields.push({ label, yours, saved });
  }
}

function buildStepNameField(localNode: CampaignFlowNode, savedNode: CampaignFlowNode): FlowConflictFieldChange[] {
  const yours = typeof localNode.data.label === 'string' ? localNode.data.label.trim() : '';
  const saved = typeof savedNode.data.label === 'string' ? savedNode.data.label.trim() : '';
  if (yours === saved) return [];
  return [{
    label: 'Step name',
    yours: yours || '(empty)',
    saved: saved || '(empty)',
  }];
}

function buildEmailSnapshotFields(node: EmailFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);
  const fields: FlowConflictFieldChange[] = [
    { label: 'Step name', yours: value(node.data.label?.trim() || '(empty)'), saved: other(node.data.label?.trim() || '(empty)') },
    { label: 'Send mode', yours: value(formatSendMode(node.data.send_mode)), saved: other(formatSendMode(node.data.send_mode)) },
    { label: 'Mailbox', yours: value(node.data.mailboxId?.trim() || '(none)'), saved: other(node.data.mailboxId?.trim() || '(none)') },
  ];

  if (isMultiVariantEmailNode(node)) {
    getSortedVariants(node).forEach((variant, index) => {
      pushVariantSnapshotFields(fields, variant, index, side);
    });
    return fields;
  }

  fields.push(
    { label: 'Subject', yours: value(getEmailSubject(node) || '(empty)'), saved: other(getEmailSubject(node) || '(empty)') },
    { label: 'Email body', yours: value(getEmailBodyText(node) || '(empty)'), saved: other(getEmailBodyText(node) || '(empty)') },
  );
  return fields;
}

function buildWaitSnapshotFields(node: WaitTimeFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  const duration = node.data.duration?.trim();
  const unit = node.data.unit;
  const waitText = duration && unit ? formatWaitDuration(duration, unit) : '(empty)';
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);

  return [
    { label: 'Step name', yours: value(node.data.label?.trim() || '(empty)'), saved: other(node.data.label?.trim() || '(empty)') },
    { label: 'Wait', yours: value(waitText), saved: other(waitText) },
  ];
}

function buildLeadSourceSnapshotFields(node: LeadSourceFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);

  return [
    { label: 'Step name', yours: value(node.data.label?.trim() || '(empty)'), saved: other(node.data.label?.trim() || '(empty)') },
    { label: 'Custom fields', yours: value(formatFieldList(node.data.customFieldKeys)), saved: other(formatFieldList(node.data.customFieldKeys)) },
    { label: 'Standard fields', yours: value(formatFieldList(node.data.mappedStandardFieldKeys)), saved: other(formatFieldList(node.data.mappedStandardFieldKeys)) },
  ];
}

function buildDataSenderSnapshotFields(node: DataSenderFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  const endpoint = (node.data.endpoint_url ?? node.data.endpoint)?.trim() || '(empty)';
  const payload = node.data.payload
    ? formatJsonPayload(node.data.payload)
    : node.data.payload_template
      ? formatDataValue(node.data.payload_template)
      : '(empty)';
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);

  return [
    { label: 'Step name', yours: value(node.data.label?.trim() || '(empty)'), saved: other(node.data.label?.trim() || '(empty)') },
    { label: 'Webhook URL', yours: value(endpoint), saved: other(endpoint) },
    { label: 'Payload', yours: value(payload), saved: other(payload) },
    { label: 'On failure', yours: value(formatOnFailure(node.data.on_failure)), saved: other(formatOnFailure(node.data.on_failure)) },
  ];
}

function buildAiCategorizerSnapshotFields(node: AICategorizerFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  const value = (text: string) => (side === 'yours' ? text : null);
  const other = (text: string) => (side === 'saved' ? text : null);

  return [
    { label: 'Step name', yours: value(node.data.label?.trim() || '(empty)'), saved: other(node.data.label?.trim() || '(empty)') },
    { label: 'AI routing', yours: value(formatAiRouting(node.data.use_ai)), saved: other(formatAiRouting(node.data.use_ai)) },
  ];
}

function buildNodeSnapshotFields(node: CampaignFlowNode, side: 'yours' | 'saved'): FlowConflictFieldChange[] {
  switch (node.type) {
    case 'email':
      return buildEmailSnapshotFields(node, side);
    case 'waitTime':
      return buildWaitSnapshotFields(node, side);
    case 'leadSource':
      return buildLeadSourceSnapshotFields(node, side);
    case 'dataSender':
      return buildDataSenderSnapshotFields(node, side);
    case 'aiCategorizer':
      return buildAiCategorizerSnapshotFields(node, side);
    default:
      return [];
  }
}

function buildGenericDataFieldChanges(
  localNode: CampaignFlowNode,
  savedNode: CampaignFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [];
  const localData = stripNoiseFromNodeData(localNode.data as Record<string, unknown>);
  const savedData = stripNoiseFromNodeData(savedNode.data as Record<string, unknown>);
  const keys = new Set([
    ...Object.keys(localData),
    ...Object.keys(savedData),
  ]);

  for (const key of [...keys].sort()) {
    const localValue = formatDataValue(localData[key]);
    const savedValue = formatDataValue(savedData[key]);
    if (localValue !== savedValue) {
      fields.push({
        label: key,
        yours: localValue,
        saved: savedValue,
      });
    }
  }

  return fields;
}

function buildEmailFieldChanges(
  localNode: EmailFlowNode,
  savedNode: EmailFlowNode,
): FlowConflictFieldChange[] {
  const fields = buildSharedEmailNodeFields(localNode, savedNode);

  if (isMultiVariantEmail(localNode, savedNode)) {
    fields.push(...buildPerVariantEmailFieldChanges(localNode, savedNode));
    return fields;
  }

  pushFieldIfDifferent(
    fields,
    'Subject',
    getEmailSubject(localNode) || '(empty)',
    getEmailSubject(savedNode) || '(empty)',
  );

  pushFieldIfDifferent(
    fields,
    'Email body',
    getEmailBodyText(localNode) || '(empty)',
    getEmailBodyText(savedNode) || '(empty)',
  );

  return fields;
}

function buildWaitFieldChanges(
  localNode: WaitTimeFlowNode,
  savedNode: WaitTimeFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [...buildStepNameField(localNode, savedNode)];
  const localDuration = localNode.data.duration?.trim();
  const savedDuration = savedNode.data.duration?.trim();
  const localUnit = localNode.data.unit;
  const savedUnit = savedNode.data.unit;
  const localText = localDuration && localUnit ? formatWaitDuration(localDuration, localUnit) : '(empty)';
  const savedText = savedDuration && savedUnit ? formatWaitDuration(savedDuration, savedUnit) : '(empty)';
  pushFieldIfDifferent(fields, 'Wait', localText, savedText);
  return fields;
}

function buildLeadFieldChanges(
  localNode: LeadSourceFlowNode,
  savedNode: LeadSourceFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [...buildStepNameField(localNode, savedNode)];
  pushFieldIfDifferent(
    fields,
    'Custom fields',
    formatFieldList(localNode.data.customFieldKeys),
    formatFieldList(savedNode.data.customFieldKeys),
  );
  pushFieldIfDifferent(
    fields,
    'Standard fields',
    formatFieldList(localNode.data.mappedStandardFieldKeys),
    formatFieldList(savedNode.data.mappedStandardFieldKeys),
  );
  return fields;
}

function buildDataSenderFieldChanges(
  localNode: DataSenderFlowNode,
  savedNode: DataSenderFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [...buildStepNameField(localNode, savedNode)];
  const localEndpoint = (localNode.data.endpoint_url ?? localNode.data.endpoint)?.trim() || '(empty)';
  const savedEndpoint = (savedNode.data.endpoint_url ?? savedNode.data.endpoint)?.trim() || '(empty)';
  pushFieldIfDifferent(fields, 'Webhook URL', localEndpoint, savedEndpoint);

  const localPayload = localNode.data.payload
    ? formatJsonPayload(localNode.data.payload)
    : localNode.data.payload_template
      ? formatDataValue(localNode.data.payload_template)
      : '(empty)';
  const savedPayload = savedNode.data.payload
    ? formatJsonPayload(savedNode.data.payload)
    : savedNode.data.payload_template
      ? formatDataValue(savedNode.data.payload_template)
      : '(empty)';
  pushFieldIfDifferent(fields, 'Payload', localPayload, savedPayload);

  pushFieldIfDifferent(
    fields,
    'On failure',
    formatOnFailure(localNode.data.on_failure),
    formatOnFailure(savedNode.data.on_failure),
  );

  return fields;
}

function buildAiCategorizerFieldChanges(
  localNode: AICategorizerFlowNode,
  savedNode: AICategorizerFlowNode,
): FlowConflictFieldChange[] {
  const fields: FlowConflictFieldChange[] = [...buildStepNameField(localNode, savedNode)];
  pushFieldIfDifferent(
    fields,
    'AI routing',
    formatAiRouting(localNode.data.use_ai),
    formatAiRouting(savedNode.data.use_ai),
  );
  return fields;
}

function buildModifiedFieldChanges(
  localNode: CampaignFlowNode,
  savedNode: CampaignFlowNode,
): FlowConflictFieldChange[] {
  if (localNode.type !== savedNode.type) {
    return [{
      label: 'Step type',
      yours: getTypeLabel(localNode),
      saved: getTypeLabel(savedNode),
    }];
  }

  let fields: FlowConflictFieldChange[] = [];
  switch (localNode.type) {
    case 'email':
      fields = buildEmailFieldChanges(localNode, savedNode as EmailFlowNode);
      break;
    case 'waitTime':
      fields = buildWaitFieldChanges(localNode, savedNode as WaitTimeFlowNode);
      break;
    case 'leadSource':
      fields = buildLeadFieldChanges(localNode, savedNode as LeadSourceFlowNode);
      break;
    case 'dataSender':
      fields = buildDataSenderFieldChanges(localNode, savedNode as DataSenderFlowNode);
      break;
    case 'aiCategorizer':
      fields = buildAiCategorizerFieldChanges(localNode, savedNode as AICategorizerFlowNode);
      break;
    default:
      fields = [];
  }

  if (fields.length === 0) {
    fields = buildGenericDataFieldChanges(localNode, savedNode);
  }

  return fields;
}

function buildCollapsedDetail(fields: FlowConflictFieldChange[], fallback?: string): string | undefined {
  if (fields.length === 0) return fallback;
  const first = fields[0]!;
  const preview = first.yours ?? first.saved ?? '';
  const shortPreview = preview.length > 48 ? `${preview.slice(0, 45)}…` : preview;
  if (fields.length === 1) return `${first.label} · ${shortPreview}`;
  return `${fields.length} fields changed`;
}

function buildAddedNodeDiff(node: CampaignFlowNode): FlowConflictNodeDiff {
  const fields = buildNodeSnapshotFields(node, 'yours');
  return {
    nodeId: node.id,
    title: getStepTitle(node),
    typeLabel: getTypeLabel(node),
    kind: 'added',
    fields,
    detail: buildCollapsedDetail(fields, getStepDetail(node)),
  };
}

function buildRemovedNodeDiff(node: CampaignFlowNode): FlowConflictNodeDiff {
  const fields = buildNodeSnapshotFields(node, 'saved');
  return {
    nodeId: node.id,
    title: getStepTitle(node),
    typeLabel: getTypeLabel(node),
    kind: 'removed',
    fields,
    detail: buildCollapsedDetail(fields, getStepDetail(node)),
  };
}

function buildModifiedNodeDiff(
  localNode: CampaignFlowNode,
  savedNode: CampaignFlowNode,
): FlowConflictNodeDiff | null {
  const fields = buildModifiedFieldChanges(localNode, savedNode);
  if (fields.length === 0) return null;

  return {
    nodeId: localNode.id,
    title: getStepTitle(localNode),
    typeLabel: getTypeLabel(localNode),
    kind: 'modified',
    fields,
    detail: buildCollapsedDetail(fields),
  };
}

function buildAdjacency(flow: CampaignFlowData): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }
  return adjacency;
}

export function buildFlowPreviewSteps(
  flow: CampaignFlowData,
  changedNodeIds: Set<string>,
): FlowPreviewStep[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node] as const));
  const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
  const startId = leadSource?.id ?? flow.nodes[0]?.id;
  if (!startId) return [];

  const adjacency = buildAdjacency(flow);
  const visited = new Set<string>();
  const ordered: FlowPreviewStep[] = [];
  const queue = [startId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) continue;

    ordered.push({
      nodeId,
      title: getStepTitle(node),
      typeLabel: getTypeLabel(node),
      detail: getStepDetail(node),
      isChanged: changedNodeIds.has(nodeId),
    });

    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (!visited.has(targetId)) queue.push(targetId);
    }
  }

  for (const node of flow.nodes) {
    if (visited.has(node.id)) continue;
    ordered.push({
      nodeId: node.id,
      title: getStepTitle(node),
      typeLabel: getTypeLabel(node),
      detail: getStepDetail(node),
      isChanged: changedNodeIds.has(node.id),
    });
  }

  return ordered;
}

function getNodeLabel(flow: CampaignFlowData, nodeId: string): string {
  const node = flow.nodes.find((entry) => entry.id === nodeId);
  return node ? getStepTitle(node) : 'Unknown step';
}

function buildSequenceSummary(
  localFlow: CampaignFlowData,
  savedFlow: CampaignFlowData,
): string | undefined {
  const localEdges = new Set(localFlow.edges.map(edgeSignature));
  const savedEdges = new Set(savedFlow.edges.map(edgeSignature));

  const sameSize = localEdges.size === savedEdges.size;
  const sameContent = sameSize && [...localEdges].every((signature) => savedEdges.has(signature));
  if (sameContent) return undefined;

  const localOnly = [...localEdges].filter((signature) => !savedEdges.has(signature));
  const savedOnly = [...savedEdges].filter((signature) => !localEdges.has(signature));

  if (localOnly.length === 1 && savedOnly.length === 1) {
    const localParts = localOnly[0]!.split('::');
    const savedParts = savedOnly[0]!.split('::');
    const localSource = getNodeLabel(localFlow, localParts[0]!);
    const localTarget = getNodeLabel(localFlow, localParts[2]!);
    const savedSource = getNodeLabel(savedFlow, savedParts[0]!);
    const savedTarget = getNodeLabel(savedFlow, savedParts[2]!);

    if (localSource === savedSource && localTarget !== savedTarget) {
      return `${localSource} now connects to ${localTarget} (saved: ${savedTarget})`;
    }
    if (localSource !== savedSource) {
      return `Connections changed between ${localSource} → ${localTarget} and ${savedSource} → ${savedTarget}`;
    }
  }

  return 'Steps were reconnected';
}

function sortNodeDiffsByFlowOrder(
  nodeDiffs: FlowConflictNodeDiff[],
  flow: CampaignFlowData,
): FlowConflictNodeDiff[] {
  const order = buildFlowPreviewSteps(flow, new Set()).map((step) => step.nodeId);
  const rank = new Map(order.map((nodeId, index) => [nodeId, index] as const));
  return [...nodeDiffs].sort((a, b) => {
    const aRank = rank.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

export function buildFlowConflictSummary(
  localFlow: CampaignFlowData,
  savedFlow: CampaignFlowData,
): FlowConflictSummary {
  const localById = new Map(localFlow.nodes.map((node) => [node.id, node] as const));
  const savedById = new Map(savedFlow.nodes.map((node) => [node.id, node] as const));
  const changedNodeIds = new Set<string>();
  const nodeDiffs: FlowConflictNodeDiff[] = [];

  for (const [nodeId, localNode] of localById.entries()) {
    if (!savedById.has(nodeId)) {
      changedNodeIds.add(nodeId);
      nodeDiffs.push(buildAddedNodeDiff(localNode));
    }
  }

  for (const [nodeId, savedNode] of savedById.entries()) {
    if (!localById.has(nodeId)) {
      changedNodeIds.add(nodeId);
      nodeDiffs.push(buildRemovedNodeDiff(savedNode));
    }
  }

  for (const [nodeId, localNode] of localById.entries()) {
    const savedNode = savedById.get(nodeId);
    if (!savedNode) continue;
    const modified = buildModifiedNodeDiff(localNode, savedNode);
    if (modified) {
      changedNodeIds.add(nodeId);
      nodeDiffs.push(modified);
    }
  }

  const sequenceSummary = buildSequenceSummary(localFlow, savedFlow);

  return {
    yoursSteps: buildFlowPreviewSteps(localFlow, changedNodeIds),
    savedSteps: buildFlowPreviewSteps(savedFlow, changedNodeIds),
    nodeDiffs: sortNodeDiffsByFlowOrder(nodeDiffs, localFlow),
    sequenceSummary,
  };
}

/** True when revision hashes differ but the conflict UI would show no meaningful delta. */
export function isSpuriousFlowConflict(
  localFlow: CampaignFlowData,
  savedFlow: CampaignFlowData,
): boolean {
  const summary = buildFlowConflictSummary(localFlow, savedFlow);
  return summary.nodeDiffs.length === 0 && !summary.sequenceSummary;
}
