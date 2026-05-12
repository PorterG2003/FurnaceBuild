type FlowNodeLike = {
  id: string;
  type?: string;
  position?: {
    x?: number;
    y?: number;
  };
};

type FlowEdgeLike = {
  source?: string;
  target?: string;
};

type FlowDataLike<TNode extends FlowNodeLike> = {
  nodes?: TNode[] | null;
  edges?: FlowEdgeLike[] | null;
};

function compareNodeFallbackOrder<TNode extends FlowNodeLike>(
  left: { node: TNode; index: number },
  right: { node: TNode; index: number },
): number {
  const leftX = typeof left.node.position?.x === 'number' ? left.node.position.x : Number.POSITIVE_INFINITY;
  const rightX = typeof right.node.position?.x === 'number' ? right.node.position.x : Number.POSITIVE_INFINITY;
  if (leftX !== rightX) return leftX - rightX;

  const leftY = typeof left.node.position?.y === 'number' ? left.node.position.y : Number.POSITIVE_INFINITY;
  const rightY = typeof right.node.position?.y === 'number' ? right.node.position.y : Number.POSITIVE_INFINITY;
  if (leftY !== rightY) return leftY - rightY;

  return left.index - right.index;
}

export function getEmailNodesInSendOrder<TNode extends FlowNodeLike>(
  flowData: FlowDataLike<TNode> | null | undefined,
): TNode[] {
  const nodes = Array.isArray(flowData?.nodes) ? flowData.nodes : [];
  const edges = Array.isArray(flowData?.edges) ? flowData.edges : [];
  if (nodes.length === 0) return [];

  const indexedNodes = nodes.map((node, index) => ({ node, index }));
  const fallbackRank = new Map(
    [...indexedNodes]
      .sort(compareNodeFallbackOrder)
      .map(({ node }, index) => [node.id, index] as const),
  );

  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const rootNodes = (() => {
    const leadSourceNodes = indexedNodes.filter(({ node }) => node.type === 'leadSource');
    if (leadSourceNodes.length > 0) return leadSourceNodes;
    return indexedNodes.filter(({ node }) => (indegree.get(node.id) ?? 0) === 0);
  })().sort(compareNodeFallbackOrder);

  const emailStage = new Map<string, number>();
  const queue: string[] = [];

  for (const { node } of rootNodes) {
    const initialStage = node.type === 'email' ? 1 : 0;
    const previousStage = emailStage.get(node.id);
    if (previousStage === undefined || initialStage < previousStage) {
      emailStage.set(node.id, initialStage);
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;

    const currentStage = emailStage.get(nodeId);
    if (currentStage === undefined) continue;

    for (const targetId of outgoing.get(nodeId) ?? []) {
      const targetNode = nodeById.get(targetId);
      if (!targetNode) continue;

      const candidateStage = currentStage + (targetNode.type === 'email' ? 1 : 0);
      const previousStage = emailStage.get(targetId);

      if (previousStage === undefined || candidateStage < previousStage) {
        emailStage.set(targetId, candidateStage);
        queue.push(targetId);
      }
    }
  }

  return indexedNodes
    .filter(({ node }) => node.type === 'email')
    .sort((left, right) => {
      const leftStage = emailStage.get(left.node.id) ?? Number.POSITIVE_INFINITY;
      const rightStage = emailStage.get(right.node.id) ?? Number.POSITIVE_INFINITY;
      if (leftStage !== rightStage) return leftStage - rightStage;

      const fallbackDelta =
        (fallbackRank.get(left.node.id) ?? Number.POSITIVE_INFINITY)
        - (fallbackRank.get(right.node.id) ?? Number.POSITIVE_INFINITY);
      if (fallbackDelta !== 0) return fallbackDelta;

      return left.index - right.index;
    })
    .map(({ node }) => node);
}
