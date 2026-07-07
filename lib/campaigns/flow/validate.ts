import {
  extractMalformedVariables,
  extractVariableKeys,
  getLeadVariables,
  type LeadVariable,
} from '../../email/index.js';
import { CATEGORIZER_SOURCE_HANDLE_IDS } from '../../categorizer/index.js';
import { isValidCustomFieldKey } from '../../leads/csv-dedupe.js';
import type {
  CampaignFlowData,
  CampaignFlowEdge,
  CampaignFlowNode,
  FlowNodeType,
  FlowValidationIssue,
  FlowValidationResult,
} from './types';

const ALLOWED_NODE_TYPES = new Set<FlowNodeType>([
  'leadSource',
  'email',
  'waitTime',
  'aiCategorizer',
  'dataSender',
]);

const ALLOWED_STANDARD_FIELD_KEYS = new Set(
  getLeadVariables(undefined, [])
    .map((variable: LeadVariable) => variable.token.replace(/^\{\{|\}\}$/g, ''))
    .filter((key: string) => !key.startsWith('custom.')),
);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_FLOW_NODES = 100;
const MAX_FLOW_EDGES = 200;
const MAX_EMAIL_VARIANTS = 20;
const MAX_TEXT_LENGTH = 100_000;

function pushIssue(issues: FlowValidationIssue[], path: string, code: string, message: string) {
  issues.push({ path, code, message });
}

function buildAllowedVariableKeys(flowData: CampaignFlowData): Set<string> {
  const leadSourceNode = flowData.nodes.find((node) => node.type === 'leadSource');
  const customFieldKeys = Array.isArray(leadSourceNode?.data?.customFieldKeys)
    ? leadSourceNode.data.customFieldKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const mappedStandardFieldKeys = Array.isArray(leadSourceNode?.data?.mappedStandardFieldKeys)
    ? leadSourceNode.data.mappedStandardFieldKeys.filter((key): key is string => typeof key === 'string')
    : undefined;

  return new Set(
    getLeadVariables(mappedStandardFieldKeys, customFieldKeys)
      .map((variable: LeadVariable) => variable.token.replace(/^\{\{|\}\}$/g, '')),
  );
}

function validateTemplateVariables(
  issues: FlowValidationIssue[],
  path: string,
  validKeys: Set<string>,
  ...texts: Array<string | undefined>
) {
  const malformed = extractMalformedVariables(...texts);
  for (const fragment of malformed) {
    pushIssue(issues, path, 'malformed_merge_variable', `Malformed merge variable: ${fragment}`);
  }

  const variableKeys = extractVariableKeys(...texts);
  for (const key of variableKeys) {
    if (!validKeys.has(key)) {
      pushIssue(issues, path, 'unknown_merge_variable', `Unknown merge variable: {{${key}}}`);
    }
  }
}

function validateLeadSourceNode(
  node: CampaignFlowNode,
  issues: FlowValidationIssue[],
  nodeIndex: number,
) {
  const customFieldKeys = Array.isArray(node.data?.customFieldKeys) ? node.data.customFieldKeys : [];
  for (const [index, key] of customFieldKeys.entries()) {
    if (typeof key !== 'string' || !isValidCustomFieldKey(key)) {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.customFieldKeys[${index}]`,
        'invalid_custom_field_key',
        `Invalid custom field key: ${String(key)}`,
      );
    }
  }

  const mappedStandardFieldKeys = Array.isArray(node.data?.mappedStandardFieldKeys)
    ? node.data.mappedStandardFieldKeys
    : [];
  for (const [index, key] of mappedStandardFieldKeys.entries()) {
    if (typeof key !== 'string' || !ALLOWED_STANDARD_FIELD_KEYS.has(key)) {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.mappedStandardFieldKeys[${index}]`,
        'invalid_standard_field_key',
        `Invalid mapped standard field key: ${String(key)}`,
      );
    }
  }
}

function validateEmailNode(
  node: CampaignFlowNode,
  issues: FlowValidationIssue[],
  nodeIndex: number,
  validVariableKeys: Set<string>,
) {
  const variants = Array.isArray(node.data?.variants) ? node.data.variants : [];
  if (variants.length === 0) {
    pushIssue(
      issues,
      `nodes[${nodeIndex}].data.variants`,
      'missing_variants',
      `Email node "${node.id}" must include at least one variant.`,
    );
    return;
  }
  if (variants.length > MAX_EMAIL_VARIANTS) {
    pushIssue(
      issues,
      `nodes[${nodeIndex}].data.variants`,
      'too_many_variants',
      `Email node "${node.id}" exceeds the ${MAX_EMAIL_VARIANTS} variant limit.`,
    );
  }

  let activeCount = 0;
  for (const [variantIndex, variant] of variants.entries()) {
    if (variant?.isActive !== false) activeCount += 1;
    if (typeof variant?.id !== 'string' || !UUID_REGEX.test(variant.id)) {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.variants[${variantIndex}].id`,
        'invalid_variant_id',
        'Email variants must have a stable UUID id.',
      );
    }
    if (typeof variant?.subject !== 'string') {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.variants[${variantIndex}].subject`,
        'invalid_variant_subject',
        'Variant subject must be a string.',
      );
    }
    if (typeof variant?.template !== 'string') {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.variants[${variantIndex}].template`,
        'invalid_variant_template',
        'Variant template must be a string.',
      );
    }
    if (String(variant?.subject ?? '').length > MAX_TEXT_LENGTH || String(variant?.template ?? '').length > MAX_TEXT_LENGTH) {
      pushIssue(
        issues,
        `nodes[${nodeIndex}].data.variants[${variantIndex}]`,
        'variant_content_too_large',
        'Variant content exceeds the maximum length.',
      );
    }

    validateTemplateVariables(
      issues,
      `nodes[${nodeIndex}].data.variants[${variantIndex}]`,
      validVariableKeys,
      typeof variant?.subject === 'string' ? variant.subject : undefined,
      typeof variant?.template === 'string' ? variant.template : undefined,
      typeof variant?.body_html === 'string' ? variant.body_html : undefined,
    );
  }

  if (activeCount === 0) {
    pushIssue(
      issues,
      `nodes[${nodeIndex}].data.variants`,
      'no_active_variants',
      `Email node "${node.id}" must keep at least one active variant.`,
    );
  }

  if (node.data?.send_mode && node.data.send_mode !== 'new' && node.data.send_mode !== 'reply') {
    pushIssue(
      issues,
      `nodes[${nodeIndex}].data.send_mode`,
      'invalid_send_mode',
      `Invalid send mode "${String(node.data.send_mode)}".`,
    );
  }
}

function validateWaitTimeNode(node: CampaignFlowNode, issues: FlowValidationIssue[], nodeIndex: number) {
  const seconds = node.data?.wait_duration_seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    pushIssue(
      issues,
      `nodes[${nodeIndex}].data.wait_duration_seconds`,
      'invalid_wait_duration',
      `Wait node "${node.id}" must define a positive wait_duration_seconds value.`,
    );
  }
}

function validateDataSenderNode(
  node: CampaignFlowNode,
  issues: FlowValidationIssue[],
  nodeIndex: number,
  validVariableKeys: Set<string>,
) {
  const payload = typeof node.data?.payload === 'string'
    ? node.data.payload
    : typeof node.data?.payload_template === 'object' && node.data.payload_template
      ? JSON.stringify(node.data.payload_template)
      : '';

  validateTemplateVariables(
    issues,
    `nodes[${nodeIndex}].data.payload`,
    validVariableKeys,
    payload,
  );
}

function buildAdjacency(edges: CampaignFlowEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = adjacency.get(edge.source) ?? [];
    existing.push(edge.target);
    adjacency.set(edge.source, existing);
  }
  return adjacency;
}

function detectReachabilityIssues(
  flowData: CampaignFlowData,
  issues: FlowValidationIssue[],
  leadSourceNodeId: string | undefined,
) {
  if (!leadSourceNodeId) return;
  const adjacency = buildAdjacency(flowData.edges);
  const visited = new Set<string>();
  const queue = [leadSourceNodeId];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    for (const target of adjacency.get(next) ?? []) {
      if (!visited.has(target)) queue.push(target);
    }
  }

  flowData.nodes.forEach((node, index) => {
    if (!visited.has(node.id)) {
      pushIssue(
        issues,
        `nodes[${index}]`,
        'unreachable_node',
        `Node "${node.id}" is not reachable from the lead source node.`,
      );
    }
  });
}

function detectCycles(flowData: CampaignFlowData, issues: FlowValidationIssue[]) {
  const adjacency = buildAdjacency(flowData.edges);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = [...path.slice(cycleStart), nodeId].join(' -> ');
      pushIssue(issues, 'edges', 'cycle_detected', `Flow cycles are not allowed: ${cycle}`);
      return;
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    path.push(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      dfs(target);
    }
    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of flowData.nodes) {
    dfs(node.id);
  }
}

export function validateFlowData(flowData: CampaignFlowData): FlowValidationResult {
  const issues: FlowValidationIssue[] = [];

  if (!Array.isArray(flowData.nodes)) {
    pushIssue(issues, 'nodes', 'invalid_nodes', 'Flow nodes must be an array.');
    return { issues };
  }
  if (!Array.isArray(flowData.edges)) {
    pushIssue(issues, 'edges', 'invalid_edges', 'Flow edges must be an array.');
    return { issues };
  }

  if (flowData.nodes.length > MAX_FLOW_NODES) {
    pushIssue(issues, 'nodes', 'too_many_nodes', `Flow exceeds the ${MAX_FLOW_NODES} node limit.`);
  }
  if (flowData.edges.length > MAX_FLOW_EDGES) {
    pushIssue(issues, 'edges', 'too_many_edges', `Flow exceeds the ${MAX_FLOW_EDGES} edge limit.`);
  }

  const nodeIds = new Set<string>();
  const nodeById = new Map<string, CampaignFlowNode>();
  let leadSourceCount = 0;
  let categorizerCount = 0;

  for (const [index, node] of flowData.nodes.entries()) {
    if (!node.id) {
      pushIssue(issues, `nodes[${index}].id`, 'missing_node_id', 'Flow nodes must have a non-empty id.');
    } else if (nodeIds.has(node.id)) {
      pushIssue(issues, `nodes[${index}].id`, 'duplicate_node_id', `Duplicate flow node id "${node.id}".`);
    } else {
      nodeIds.add(node.id);
      nodeById.set(node.id, node);
    }

    if (!ALLOWED_NODE_TYPES.has(node.type as FlowNodeType)) {
      pushIssue(
        issues,
        `nodes[${index}].type`,
        'invalid_node_type',
        `Unsupported node type "${String(node.type)}".`,
      );
      continue;
    }

    if (node.type === 'leadSource') leadSourceCount += 1;
    if (node.type === 'aiCategorizer') categorizerCount += 1;
  }

  if (leadSourceCount !== 1) {
    pushIssue(issues, 'nodes', 'invalid_lead_source_count', 'Flow must contain exactly one leadSource node.');
  }
  if (categorizerCount > 1) {
    pushIssue(issues, 'nodes', 'too_many_categorizers', 'Flow can include at most one aiCategorizer node.');
  }

  const validVariableKeys = buildAllowedVariableKeys(flowData);

  for (const [index, node] of flowData.nodes.entries()) {
    switch (node.type) {
      case 'leadSource':
        validateLeadSourceNode(node, issues, index);
        break;
      case 'email':
        validateEmailNode(node, issues, index, validVariableKeys);
        break;
      case 'waitTime':
        validateWaitTimeNode(node, issues, index);
        break;
      case 'dataSender':
        validateDataSenderNode(node, issues, index, validVariableKeys);
        break;
      case 'aiCategorizer':
      default:
        break;
    }
  }

  const edgeIds = new Set<string>();
  const categorizerBranchUsage = new Map<string, Set<string>>();

  for (const [index, edge] of flowData.edges.entries()) {
    if (!edge.id) {
      pushIssue(issues, `edges[${index}].id`, 'missing_edge_id', 'Flow edges must have a non-empty id.');
    } else if (edgeIds.has(edge.id)) {
      pushIssue(issues, `edges[${index}].id`, 'duplicate_edge_id', `Duplicate edge id "${edge.id}".`);
    } else {
      edgeIds.add(edge.id);
    }

    if (!edge.source || !nodeById.has(edge.source)) {
      pushIssue(
        issues,
        `edges[${index}].source`,
        'unknown_edge_source',
        `Edge source "${edge.source}" does not reference a known node.`,
      );
    }
    if (!edge.target || !nodeById.has(edge.target)) {
      pushIssue(
        issues,
        `edges[${index}].target`,
        'unknown_edge_target',
        `Edge target "${edge.target}" does not reference a known node.`,
      );
    }
    if (edge.source && edge.target && edge.source === edge.target) {
      pushIssue(
        issues,
        `edges[${index}]`,
        'self_referential_edge',
        `Edge "${edge.id}" cannot point a node to itself.`,
      );
    }

    const sourceNode = edge.source ? nodeById.get(edge.source) : null;
    if (sourceNode?.type === 'aiCategorizer') {
      if (!edge.sourceHandle || !CATEGORIZER_SOURCE_HANDLE_IDS.includes(edge.sourceHandle as never)) {
        pushIssue(
          issues,
          `edges[${index}].sourceHandle`,
          'invalid_categorizer_source_handle',
          `Categorizer edge "${edge.id}" must use one of: ${CATEGORIZER_SOURCE_HANDLE_IDS.join(', ')}.`,
        );
      } else {
        const usedHandles = categorizerBranchUsage.get(sourceNode.id) ?? new Set<string>();
        if (usedHandles.has(edge.sourceHandle)) {
          pushIssue(
            issues,
            `edges[${index}].sourceHandle`,
            'duplicate_categorizer_branch',
            `Categorizer node "${sourceNode.id}" already uses sourceHandle "${edge.sourceHandle}".`,
          );
        }
        usedHandles.add(edge.sourceHandle);
        categorizerBranchUsage.set(sourceNode.id, usedHandles);
      }
    }
  }

  detectReachabilityIssues(
    flowData,
    issues,
    flowData.nodes.find((node) => node.type === 'leadSource')?.id,
  );
  detectCycles(flowData, issues);

  return { issues };
}

export type FlowValidationPhase = 'draft' | 'launch';

export type PhaseValidationResult = FlowValidationResult & {
  blockingIssues: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
};

const WARNING_CODES_IN_DRAFT = new Set(['unreachable_node']);

function pushLaunchIssue(issues: FlowValidationIssue[], code: string, message: string) {
  pushIssue(issues, 'nodes', code, message);
}

export function validateForPhase(
  flowData: CampaignFlowData,
  phase: FlowValidationPhase,
): PhaseValidationResult {
  const base = validateFlowData(flowData);
  const launchOnlyIssues: FlowValidationIssue[] = [];

  if (phase === 'launch') {
    if (!flowData.nodes.some((node) => node.type === 'email')) {
      pushLaunchIssue(
        launchOnlyIssues,
        'launch_email_required',
        'Launch requires at least one email node in the flow.',
      );
    }
    const leadSource = flowData.nodes.find((node) => node.type === 'leadSource');
    if (leadSource && flowData.edges.filter((edge) => edge.source === leadSource.id).length === 0) {
      pushLaunchIssue(
        launchOnlyIssues,
        'launch_flow_disconnected',
        'Launch requires the lead source to connect to at least one downstream node.',
      );
    }
  }

  const issues = [...base.issues, ...launchOnlyIssues];
  const warnings = phase === 'draft'
    ? issues.filter((issue) => WARNING_CODES_IN_DRAFT.has(issue.code))
    : [];
  const blockingIssues = phase === 'draft'
    ? issues.filter((issue) => !WARNING_CODES_IN_DRAFT.has(issue.code))
    : issues;

  return { issues, blockingIssues, warnings };
}
