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
 * Result of flow evaluation
 */
export interface FlowEvaluationResult {
  nodes: DatabaseNode[];
  waitingForEmail?: boolean; // True if no nodes because waiting for email to be sent
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
 * @returns FlowEvaluationResult with nodes and optional waitingForEmail flag
 */
export async function evaluateFlow(
  enrollment: Enrollment,
  campaignId: string,
  flowData: any,
  supabase: SupabaseClient
): Promise<FlowEvaluationResult> {
  const enrollmentId = enrollment.id.substring(0, 8);
  console.log(`[FLOW ${enrollmentId}] Evaluating flow. Campaign: ${campaignId.substring(0, 8)}, Current node: ${enrollment.current_node_id?.substring(0, 8) || 'null'}`);
  
  // Validate flow_data structure
  if (!flowData) {
    const error = `Invalid flow_data: flow_data is null or undefined for enrollment ${enrollment.id}`;
    console.error(`[FLOW ${enrollmentId}] ${error}`);
    // TODO: Send to Slack error reporting channel - Invalid flow data
    return { nodes: [] };
  }

  if (!flowData.edges || !Array.isArray(flowData.edges)) {
    const error = `Invalid flow_data: edges array is missing or invalid for enrollment ${enrollment.id}`;
    console.error(`[FLOW ${enrollmentId}] ${error}`);
    // TODO: Send to Slack error reporting channel - Invalid flow edges
    return { nodes: [] };
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
      return { nodes: [] };
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
        return { nodes: [] };
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
        return { nodes: [] };
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
      return { nodes: filteredNodes };
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
      return { nodes: [] };
    }

    if (firstNodes && firstNodes.length > 0) {
      console.log(`[FLOW ${enrollmentId}] Using first non-leadSource node as entry: ${firstNodes[0].flow_node_id}`);
      return { nodes: [firstNodes[0] as DatabaseNode] };
    }

    console.warn(`[FLOW ${enrollmentId}] No entry point nodes found for campaign ${campaignId.substring(0, 8)}. Flow cannot be evaluated.`);
    // TODO: Send to Slack error reporting channel - No entry point nodes (critical)
    return { nodes: [] };
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
    return { nodes: [] };
  }

  // If current node is an email node, check if the message_job has been sent
  // We should not advance to the next node until the email is actually sent
  if (currentNode.node_type === 'email') {
    const { data: messageJobs, error: messageJobsError } = await supabase
      .from('message_jobs')
      .select('id, sent_at, status')
      .eq('enrollment_id', enrollment.id)
      .eq('node_id', currentNode.id)
      .order('created_at', { ascending: false })
      .limit(1); // In normal flow, there should be only one
    
    if (messageJobsError) {
      console.error(`[FLOW ${enrollmentId}] Error checking message job for email node ${currentNode.id.substring(0, 8)}: ${messageJobsError.message}`);
      // Don't advance if we can't check - safer to wait
      return { nodes: [], waitingForEmail: true };
    }
    
    if (!messageJobs || messageJobs.length === 0) {
      // No message_job found - shouldn't happen in normal flow, but don't advance
      console.warn(`[FLOW ${enrollmentId}] No message_job found for email node ${currentNode.id.substring(0, 8)} (enrollment ${enrollment.id.substring(0, 8)})`);
      return { nodes: [], waitingForEmail: true };
    }
    
    const messageJob = messageJobs[0]; // Get the (should be only) message_job
    
    // Check if the message_job has been sent
    const isSent = messageJob.sent_at !== null || messageJob.status === 'sent';
    
    if (!isSent) {
      // Email not sent yet - don't advance to next node
      // Send worker will update enrollment.next_run_at when email is sent, triggering re-evaluation
      console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id.substring(0, 8)} has unsent message_job. Waiting for send worker...`);
      return { nodes: [], waitingForEmail: true };
    }
    
    // Email has been sent - continue with normal flow evaluation
    console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id.substring(0, 8)} has message_job sent. Proceeding to next node.`);
  }

  // Find edges starting from current node's flow_node_id
  const nextEdges = edges.filter((edge: any) => edge.source === currentNode.flow_node_id);
  
  if (nextEdges.length === 0) {
    // No next edges - flow complete
    return { nodes: [] };
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
    return { nodes: [] };
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

  return { nodes: filteredNodes };
}

