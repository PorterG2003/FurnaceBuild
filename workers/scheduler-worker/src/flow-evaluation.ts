import type { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment } from './types.js';

/**
 * Database node structure (from nodes table)
 */
export interface DatabaseNode {
  id: string; // Database UUID
  campaign_id: string;
  flow_node_id: string; // React Flow ID (e.g., "email-1")
  node_type: string;
  node_data: Record<string, any>;
  position_x?: number;
  position_y?: number;
}

/**
 * Evaluate flow graph to find next node(s) from current position
 * 
 * This function:
 * 1. Loads nodes from database (not flow_data)
 * 2. Uses enrollment.current_node_id (database UUID) to find current node
 * 3. Uses flow_data.edges to find next nodes (by flow_node_id)
 * 4. Returns database nodes (with database UUIDs) for processing
 * 
 * @param enrollment - The enrollment being processed
 * @param campaignId - Campaign ID to load nodes for
 * @param flowData - Campaign flow_data (for edges)
 * @param supabase - Supabase client
 * @returns Array of database nodes to process next
 */
export async function evaluateFlow(
  enrollment: Enrollment,
  campaignId: string,
  flowData: any,
  supabase: SupabaseClient
): Promise<DatabaseNode[]> {
  if (!flowData || !flowData.edges) {
    console.warn(`Invalid flow_data for enrollment ${enrollment.id}`);
    return [];
  }

  const edges = flowData.edges || [];
  
  // Handle entry point (no current_node_id)
  if (!enrollment.current_node_id) {
    // Find entry node from database (usually leadSource node)
    const { data: entryNodes, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('node_type', 'leadSource')
      .limit(1);

    if (error) {
      console.error(`Error loading entry node: ${error.message}`);
      return [];
    }

    if (entryNodes && entryNodes.length > 0) {
      return [entryNodes[0] as DatabaseNode];
    }

    // Fallback: Get first node (non-leadSource)
    const { data: firstNodes, error: firstError } = await supabase
      .from('nodes')
      .select('*')
      .eq('campaign_id', campaignId)
      .neq('node_type', 'leadSource')
      .order('created_at', { ascending: true })
      .limit(1);

    if (firstError) {
      console.error(`Error loading first node: ${firstError.message}`);
      return [];
    }

    if (firstNodes && firstNodes.length > 0) {
      return [firstNodes[0] as DatabaseNode];
    }

    return [];
  }
  
  // Load current node from database to get its flow_node_id
  const { data: currentNode, error: currentNodeError } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', enrollment.current_node_id)
    .eq('campaign_id', campaignId)
    .single();

  if (currentNodeError || !currentNode) {
    console.error(`Current node ${enrollment.current_node_id} not found: ${currentNodeError?.message}`);
    return [];
  }

  // Find edges starting from current node's flow_node_id
  const nextEdges = edges.filter((edge: any) => edge.source === currentNode.flow_node_id);
  
  if (nextEdges.length === 0) {
    // No next edges - flow complete
    return [];
  }

  // Get target flow_node_ids from edges
  const targetFlowNodeIds = nextEdges.map((edge: any) => edge.target);

  // Load corresponding database nodes by flow_node_id
  const { data: nextNodes, error: nextNodesError } = await supabase
    .from('nodes')
    .select('*')
    .eq('campaign_id', campaignId)
    .in('flow_node_id', targetFlowNodeIds);

  if (nextNodesError) {
    console.error(`Error loading next nodes: ${nextNodesError.message}`);
    return [];
  }

  // Filter out leadSource nodes (they should only be entry points, not in traversal)
  const filteredNodes = (nextNodes || []).filter(
    (node: any) => node.node_type !== 'leadSource'
  ) as DatabaseNode[];

  // Log warning if leadSource nodes were filtered out
  if (filteredNodes.length < (nextNodes || []).length) {
    console.warn(
      `Filtered out ${(nextNodes || []).length - filteredNodes.length} leadSource node(s) from traversal for enrollment ${enrollment.id}`
    );
  }

  return filteredNodes;
}

