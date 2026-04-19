import { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import type { Enrollment } from '../types.js';

/**
 * Handle DataSender node: send data to external endpoint
 * 
 * PLACEHOLDER IMPLEMENTATION:
 * - Basic structure only
 * - Phase 3.4+: Will implement actual HTTP request logic
 * 
 * @param enrollment - The enrollment being processed
 * @param node - The DataSender node from the flow
 * @param supabase - Supabase client
 */
export async function handleDataSenderNode(
  enrollment: Enrollment,
  node: any,
  flowVersionNumber: number | null,
  supabase: SupabaseClient
): Promise<void> {
  // 1. Extract data sender config from node.node_data
  const endpointUrl = node.node_data?.endpoint_url;
  const method = node.node_data?.method || 'POST';
  const payloadTemplate = node.node_data?.payload_template || {};

  // 2. PLACEHOLDER: Log what would be sent
  // Phase 3.4+: Will implement actual HTTP request
  console.log(`[PLACEHOLDER] DataSender node ${node.id} would send ${method} request to ${endpointUrl}`);
  console.log(`[PLACEHOLDER] Payload template:`, payloadTemplate);

  // TODO Phase 3.4+:
  // - Load lead data
  // - Render payload template with lead data
  // - Make HTTP request to endpoint
  // - Handle errors and retries
  // - Store result in enrollment or separate table

  // 3. Update enrollment
  // Set next_run_at to NOW() + 1 minute to evaluate next node immediately
  const nextRunAt = new Date(Date.now() + 60 * 1000).toISOString();

  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      current_flow_version_number: flowVersionNumber,
      next_run_at: nextRunAt,
    })
    .eq('id', enrollment.id);

  if (error) {
    const errorMsg = `Failed to update enrollment ${enrollment.id} after DataSender node ${node.id}: ${error.message}`;
    console.error(errorMsg);
    reportErrorToSlack('DataSender enrollment update error', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      node_id: node.id,
      error: error.message,
    });
    throw new Error(errorMsg);
  }
}

