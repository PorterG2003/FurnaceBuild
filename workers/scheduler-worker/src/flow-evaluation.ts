import type { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
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
  deleted_at?: string | null;
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
    reportErrorToSlack('Invalid flow_data: null or undefined', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
    });
    return { nodes: [] };
  }

  if (!flowData.edges || !Array.isArray(flowData.edges)) {
    const error = `Invalid flow_data: edges array is missing or invalid for enrollment ${enrollment.id}`;
    console.error(`[FLOW ${enrollmentId}] ${error}`);
    reportErrorToSlack('Invalid flow_data: edges array missing or invalid', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
    });
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
      .is('deleted_at', null)
      .eq('node_type', 'leadSource')
      .limit(1);

    if (error) {
      console.error(`[FLOW ${enrollmentId}] Error loading entry node: ${error.message}`);
      reportErrorToSlack('Database error loading entry node', {
        severity: 'critical',
        enrollment_id: enrollment.id,
        campaign_id: campaignId,
        error: error.message,
      });
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
        reportErrorToSlack('No edges from leadSource node', {
          severity: 'warning',
          enrollment_id: enrollment.id,
          campaign_id: campaignId,
        });
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
        .is('deleted_at', null)
        .in('flow_node_id', targetFlowNodeIds);

      if (nextNodesError) {
        console.error(`[FLOW ${enrollmentId}] Error loading nodes after leadSource: ${nextNodesError.message}`);
        reportErrorToSlack('Database error loading nodes after leadSource', {
          severity: 'critical',
          enrollment_id: enrollment.id,
          campaign_id: campaignId,
          error: nextNodesError.message,
        });
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
    reportErrorToSlack('No leadSource node found for campaign', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
    });
    const { data: firstNodes, error: firstError } = await supabase
      .from('nodes')
      .select('*')
      .eq('campaign_id', campaignId)
      .is('deleted_at', null)
      .neq('node_type', 'leadSource')
      .order('created_at', { ascending: true })
      .limit(1);

    if (firstError) {
      console.error(`[FLOW ${enrollmentId}] Error loading first node: ${firstError.message}`);
      reportErrorToSlack('Database error loading first node', {
        severity: 'critical',
        enrollment_id: enrollment.id,
        campaign_id: campaignId,
        error: firstError.message,
      });
      return { nodes: [] };
    }

    if (firstNodes && firstNodes.length > 0) {
      console.log(`[FLOW ${enrollmentId}] Using first non-leadSource node as entry: ${firstNodes[0].flow_node_id}`);
      return { nodes: [firstNodes[0] as DatabaseNode] };
    }

    console.warn(`[FLOW ${enrollmentId}] No entry point nodes found for campaign ${campaignId.substring(0, 8)}. Flow cannot be evaluated.`);
    reportErrorToSlack('No entry point nodes for campaign (flow cannot be evaluated)', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
    });
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
    reportErrorToSlack('Missing node in database (enrollment references non-existent node)', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
      current_node_id: enrollment.current_node_id ?? '',
    });
    throw new Error(error);
  }

  if ((currentNode as DatabaseNode).deleted_at) {
    const error = `Current node ${enrollment.current_node_id} has been deleted for enrollment ${enrollment.id}`;
    console.error(error);
    reportErrorToSlack('Deleted node referenced by enrollment', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: campaignId,
      current_node_id: enrollment.current_node_id ?? '',
    });
    throw new Error(error);
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
    
    // Check if the message_job has been sent or is terminal (cancelled = e.g. block list; don't retry)
    const isSent = messageJob.sent_at !== null || messageJob.status === 'sent';
    const isTerminal = messageJob.status === 'cancelled' || messageJob.status === 'failed' || messageJob.status === 'blocked';
    
    if (!isSent && !isTerminal) {
      // Email not sent yet and not terminal - don't advance to next node
      // Send worker will update enrollment.next_run_at when email is sent, triggering re-evaluation
      console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id.substring(0, 8)} has unsent message_job. Waiting for send worker...`);
      return { nodes: [], waitingForEmail: true };
    }
    
    if (isTerminal) {
      console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id.substring(0, 8)} has message_job ${messageJob.status}. Proceeding to next node.`);
    } else {
      console.log(`[FLOW ${enrollmentId}] Email node ${currentNode.id.substring(0, 8)} has message_job sent. Proceeding to next node.`);
    }
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
    .is('deleted_at', null)
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

