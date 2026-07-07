import type { CampaignFlowData, CampaignFlowNode, FlowChangeKind } from './types';

export type FlowChangeSummary = {
  kind: FlowChangeKind;
  reasons: string[];
};

function edgeSignature(edge: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
  return [
    edge.source,
    edge.sourceHandle ?? '',
    edge.target,
    edge.targetHandle ?? '',
  ].join('::');
}

function variantIdsByNode(flowData: CampaignFlowData): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const node of flowData.nodes) {
    if (node.type !== 'email') continue;
    const variants = Array.isArray(node.data?.variants) ? node.data.variants : [];
    result.set(
      node.id,
      new Set(
        variants
          .map((variant) => (typeof variant?.id === 'string' ? variant.id : ''))
          .filter(Boolean),
      ),
    );
  }
  return result;
}

function hasRemovedVariantIds(previous: Set<string>, next: Set<string>): boolean {
  for (const id of previous) {
    if (!next.has(id)) return true;
  }
  return false;
}

export function classifyFlowChange(
  storedFlowData: CampaignFlowData,
  incomingFlowData: CampaignFlowData,
): FlowChangeSummary {
  const reasons = new Set<string>();
  const storedJson = JSON.stringify(storedFlowData);
  const incomingJson = JSON.stringify(incomingFlowData);

  const previousNodeById = new Map(storedFlowData.nodes.map((node) => [node.id, node] as const));
  const nextNodeById = new Map(incomingFlowData.nodes.map((node) => [node.id, node] as const));

  for (const previousNodeId of previousNodeById.keys()) {
    if (!nextNodeById.has(previousNodeId)) {
      reasons.add('node_removed');
    }
  }
  for (const nextNodeId of nextNodeById.keys()) {
    if (!previousNodeById.has(nextNodeId)) {
      reasons.add('node_added');
    }
  }

  for (const [nodeId, previousNode] of previousNodeById.entries()) {
    const nextNode = nextNodeById.get(nodeId);
    if (!nextNode) continue;
    if (previousNode.type !== nextNode.type) {
      reasons.add('node_type_changed');
    }
  }

  const previousEdges = new Set(storedFlowData.edges.map(edgeSignature));
  const nextEdges = new Set(incomingFlowData.edges.map(edgeSignature));
  for (const signature of previousEdges) {
    if (!nextEdges.has(signature)) reasons.add('edge_removed_or_rewired');
  }
  for (const signature of nextEdges) {
    if (!previousEdges.has(signature)) reasons.add('edge_added_or_rewired');
  }

  const previousVariantIds = variantIdsByNode(storedFlowData);
  const nextVariantIds = variantIdsByNode(incomingFlowData);
  for (const [nodeId, previousIds] of previousVariantIds.entries()) {
    const nextIds = nextVariantIds.get(nodeId) ?? new Set<string>();
    if (hasRemovedVariantIds(previousIds, nextIds)) {
      reasons.add('variant_removed_or_replaced');
    }
  }

  if (reasons.size === 0) {
    return storedJson === incomingJson
      ? { kind: 'none', reasons: [] }
      : { kind: 'content', reasons: ['content_changed'] };
  }

  const structuralReasons = new Set([
    'node_removed',
    'node_added',
    'node_type_changed',
    'edge_removed_or_rewired',
    'edge_added_or_rewired',
    'variant_removed_or_replaced',
  ]);

  const kind: FlowChangeKind = [...reasons].some((reason) => structuralReasons.has(reason))
    ? 'structural'
    : 'content';

  return {
    kind,
    reasons: [...reasons],
  };
}
