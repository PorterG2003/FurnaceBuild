import type { CampaignFlowData, CampaignFlowEdge } from './types';

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
