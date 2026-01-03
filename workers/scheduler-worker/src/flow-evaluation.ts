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
  const enrollmentId = enrollment.id.substring(0, 8);
  console.log(`[FLOW ${enrollmentId}] Evaluating flow. Campaign: ${campaignId.substring(0, 8)}, Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null'}`);
  
  // Validate flow_data structure
  if (!flowData) {
    const error = `Invalid flow_data: flow_data is null or undefined for enrollment ${enrollment.id}`;
    console.error(`[FLOW ${enrollmentId}] ${error}`);
    // TODO: Send to Slack error reporting channel - Invalid flow data
    return [];
  }

  if (!flowData.edges || !Array.isArray(flowData.edges)) {
    const error = `Invalid flow_data: edges array is missing or invalid for enrollment ${enrollment.id}`;
    console.error(`[FLOW ${enrollmentId}] ${error}`);
    // TODO: Send to Slack error reporting channel - Invalid flow edges
    return [];
  }
  
  console.log(`[FLOW ${enrollmentId}] Flow data valid. Edges: ${flowData.edges.length}`);

  const edges = flowData.edges || [];
  
  // Handle entry point (no current_node_id)
  if (!enrollment.current_node_id) {
    console.log(`[FLOW ${enrollmentId}] Entry point detected. Finding leadSource node...`);
    // Find entry node from database (usually leadSource node)
    const { data: entryNodes, error } = await supabase
      .from('nodes')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('node_type', 'leadSource')
      .limit(1);

    if (error) {
      console.error(`[FLOW ${enrollmentId}] Error loading entry node: ${error.message}`);
      // TODO: Send to Slack error reporting channel - Database error loading entry node
      return [];
    }

    if (entryNodes && entryNodes.length > 0) {
      const leadSourceNode = entryNodes[0] as DatabaseNode;
      console.log(`[FLOW ${enrollmentId}] Found leadSource node: ${leadSourceNode.flow_node_id}`);
      
      // Find edges starting from leadSource node's flow_node_id
      const nextEdges = edges.filter((edge: any) => edge.source === leadSourceNode.flow_node_id);
      console.log(`[FLOW ${enrollmentId}] Found ${nextEdges.length} edge(s) from leadSource`);
      
      if (nextEdges.length === 0) {
        console.warn(`[FLOW ${enrollmentId}] No edges found from leadSource node. Flow has no nodes to process.`);
        // TODO: Send to Slack error reporting channel - No edges from leadSource (warning)
        return [];
      }

      // Get target flow_node_ids from edges
      const targetFlowNodeIds = nextEdges.map((edge: any) => edge.target);
      console.log(`[FLOW ${enrollmentId}] Target flow node IDs: ${targetFlowNodeIds.join(', ')}`);

      // Load corresponding database nodes by flow_node_id
      const { data: nextNodes, error: nextNodesError } = await supabase
        .from('nodes')
        .select('*')
        .eq('campaign_id', campaignId)
        .in('flow_node_id', targetFlowNodeIds);

      if (nextNodesError) {
        console.error(`[FLOW ${enrollmentId}] Error loading nodes after leadSource: ${nextNodesError.message}`);
        // TODO: Send to Slack error reporting channel - Database error loading nodes after leadSource
        return [];
      }

      // Filter out leadSource nodes (they should only be entry points, not in traversal)
      const filteredNodes = (nextNodes || []).filter(
        (node: any) => node.node_type !== 'leadSource'
      ) as DatabaseNode[];

      // Log warning if leadSource nodes were filtered out
      if (filteredNodes.length < (nextNodes || []).length) {
        console.warn(
          `[FLOW ${enrollmentId}] Filtered out ${(nextNodes || []).length - filteredNodes.length} leadSource node(s) from entry point traversal`
        );
      }

      console.log(`[FLOW ${enrollmentId}] Returning ${filteredNodes.length} node(s) after leadSource`);
      return filteredNodes;
    }

    // Fallback: Get first node (non-leadSource) if no leadSource exists
    console.warn(`[FLOW ${enrollmentId}] No leadSource node found. Attempting to find first non-leadSource node as entry.`);
    // TODO: Send to Slack error reporting channel - No leadSource node (warning)
    const { data: firstNodes, error: firstError } = await supabase
      .from('nodes')
      .select('*')
      .eq('campaign_id', campaignId)
      .neq('node_type', 'leadSource')
      .order('created_at', { ascending: true })
      .limit(1);

    if (firstError) {
      console.error(`[FLOW ${enrollmentId}] Error loading first node: ${firstError.message}`);
      // TODO: Send to Slack error reporting channel - Database error loading first node
      return [];
    }

    if (firstNodes && firstNodes.length > 0) {
      console.log(`[FLOW ${enrollmentId}] Using first non-leadSource node as entry: ${firstNodes[0].flow_node_id}`);
      return [firstNodes[0] as DatabaseNode];
    }

    console.warn(`[FLOW ${enrollmentId}] No entry point nodes found for campaign ${campaignId.substring(0, 8)}. Flow cannot be evaluated.`);
    // TODO: Send to Slack error reporting channel - No entry point nodes (critical)
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
    const error = `Current node ${enrollment.current_node_id} not found for enrollment ${enrollment.id}: ${currentNodeError?.message || 'Node not found'}`;
    console.error(error);
    // TODO: Send to Slack error reporting channel - Missing node in database
    // This indicates data inconsistency (node_id exists in enrollment but not in nodes table)
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

