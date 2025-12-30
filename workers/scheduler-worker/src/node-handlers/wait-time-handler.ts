import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, CampaignSchedule } from '../types.js';
import { calculateScheduledAt } from '../scheduling.js';

/**
 * Handle waitTime node: calculate next_run_at with schedule and jitter
 * 
 * @param enrollment - The enrollment being processed
 * @param node - The waitTime node from the flow
 * @param schedule - Campaign schedule configuration (null if no schedule)
 * @param jitterPercentage - Jitter percentage (0-100, default 10)
 * @param supabase - Supabase client
 * @returns Updated enrollment next_run_at
 */
export async function handleWaitTimeNode(
  enrollment: Enrollment,
  node: any,
  schedule: CampaignSchedule | null,
  jitterPercentage: number,
  supabase: SupabaseClient
): Promise<void> {
  // 1. Extract wait duration from node.node_data (database node structure)
  // Support both 'wait_duration_seconds' and 'duration_seconds' for compatibility
  const waitDurationSeconds = node.node_data?.wait_duration_seconds || 
                               node.node_data?.duration_seconds || 
                               0;

  if (waitDurationSeconds <= 0) {
    throw new Error(`Invalid wait duration for node ${node.id}: ${waitDurationSeconds} seconds`);
  }

  // 2. Calculate base next_run_at = NOW() + wait_duration_seconds
  const baseTime = new Date();
  const baseNextRunAt = new Date(baseTime.getTime() + waitDurationSeconds * 1000);

  // 3. Apply campaign schedule and jitter using calculateScheduledAt
  const nextRunAt = calculateScheduledAt(baseNextRunAt, schedule, jitterPercentage);

  // 4. Update enrollment
  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      next_run_at: nextRunAt,
    })
    .eq('id', enrollment.id);

  if (error) {
    throw new Error(`Failed to update enrollment ${enrollment.id}: ${error.message}`);
  }
}

