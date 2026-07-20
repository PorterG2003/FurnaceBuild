import type { CampaignFlowData, CampaignFlowEdge } from './types';

/**
 * Node ids strictly reachable from any aiCategorizer via forward edges.
 * Email nodes here send on the priority lane (immediate, skip pacing).
 */
export function nodeIdsDownstreamOfCategorizer(
  nodes: ReadonlyArray<{ id?: string; type?: string }>,
  edges: ReadonlyArray<Pick<CampaignFlowEdge, 'source' | 'target'>>,
): Set<string> {
  const categorizerIds = nodes
    .filter((node) => node?.type === 'aiCategorizer' && typeof node.id === 'string')
    .map((node) => node.id as string);
  const downstream = new Set<string>();
  if (categorizerIds.length === 0) return downstream;

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }

  const queue = [...categorizerIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!downstream.has(next)) {
        downstream.add(next);
        queue.push(next);
      }
    }
  }
  return downstream;
}

type PriorityNode = {
  id?: string;
  type?: string;
};

/**
 * Priority = positional (downstream of categorizer). Sends on the immediate
 * lane regardless of subject. Threading/subject are handled uniformly by the
 * normal send path. `downstreamNodeIds` comes from
 * nodeIdsDownstreamOfCategorizer. Tolerant of raw/loosely-typed flow data so it
 * can run in normalization, the builder, and repair scripts alike.
 */
export function deriveEmailPriority(
  node: PriorityNode,
  downstreamNodeIds: ReadonlySet<string>,
): boolean {
  if (node.type !== 'email' || typeof node.id !== 'string') return false;
  return downstreamNodeIds.has(node.id);
}

/** Edges incident to any of the given node ids (source or target). */
export function edgesToRemoveForDeletedNodeIds(
  edges: ReadonlyArray<Pick<CampaignFlowEdge, 'id' | 'source' | 'target'>>,
  deletedNodeIds: ReadonlyArray<string>,
): string[] {
  const deleted = new Set(deletedNodeIds.filter(Boolean));
  if (deleted.size === 0) return [];

  const edgeIds: string[] = [];
  for (const edge of edges) {
    if (!edge.id) continue;
    if (deleted.has(edge.source) || deleted.has(edge.target)) {
      edgeIds.push(edge.id);
    }
  }
  return edgeIds;
}

/** Keep only edges whose source and target exist in the node id set. */
export function pruneOrphanEdges<T extends Pick<CampaignFlowEdge, 'source' | 'target'>>(
  edges: ReadonlyArray<T>,
  nodeIds: ReadonlySet<string> | ReadonlyArray<string>,
): T[] {
  const ids = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

/**
 * True when raw flow_data has edges that sanitize/normalize would drop.
 * Used for heal-on-open: persist cleaned graph so DB matches the canvas.
 */
export function flowNeedsOrphanEdgeHeal(
  rawFlow: { nodes?: ReadonlyArray<{ id?: string }> | null; edges?: ReadonlyArray<{ source?: string; target?: string }> | null } | null | undefined,
  sanitizedFlow: Pick<CampaignFlowData, 'nodes' | 'edges'>,
): boolean {
  const rawEdges = Array.isArray(rawFlow?.edges) ? rawFlow.edges : [];
  if (rawEdges.length === 0) return false;

  const rawNodeIds = new Set(
    (Array.isArray(rawFlow?.nodes) ? rawFlow.nodes : [])
      .map((node) => (typeof node?.id === 'string' ? node.id : ''))
      .filter(Boolean),
  );

  const rawOrphanCount = rawEdges.filter((edge) => {
    const source = typeof edge?.source === 'string' ? edge.source : '';
    const target = typeof edge?.target === 'string' ? edge.target : '';
    return !source || !target || !rawNodeIds.has(source) || !rawNodeIds.has(target);
  }).length;

  if (rawOrphanCount === 0) return false;
  return sanitizedFlow.edges.length < rawEdges.length || rawOrphanCount > 0;
}
