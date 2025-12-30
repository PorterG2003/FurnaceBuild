import type { Enrollment } from './types.js';

/**
 * Evaluate flow graph to find next node(s) from current position
 * Migrated from Lambda handler
 */
export function evaluateFlow(enrollment: Enrollment, flowData: any): any[] {
  // Placeholder implementation
  // This should:
  // - Load flow edges from flowData
  // - Find next node(s) from enrollment.current_node_id
  // - Handle branching/conditionals
  // - Return array of next nodes to process
  
  if (!flowData || !flowData.nodes || !flowData.edges) {
    console.warn(`Invalid flow_data for enrollment ${enrollment.id}`);
    return [];
  }

  const nodes = flowData.nodes;
  const edges = flowData.edges || [];
  
  // Handle entry point (no current_node_id)
  if (!enrollment.current_node_id) {
    // Find entry node (usually leadSource node or first node with no incoming edges)
    const entryNode = nodes.find((n: any) => n.type === 'leadSource') || nodes[0];
    if (entryNode) {
      // Return entry node - will be processed and current_node_id will be set
      return [entryNode];
    }
    return [];
  }
  
  // Find edges starting from current_node_id
  const nextEdges = edges.filter((edge: any) => edge.source === enrollment.current_node_id);
  
  if (nextEdges.length === 0) {
    // No next edges - flow complete
    return [];
  }

  // Get target nodes
  const nextNodes = nextEdges
    .map((edge: any) => nodes.find((n: any) => n.id === edge.target))
    .filter((node: any) => node !== undefined);

  return nextNodes;
}

