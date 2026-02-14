import { SupabaseClient } from '@supabase/supabase-js';
import type { Enrollment, CampaignSchedule } from '../types.js';
import { calculateNextRunAt } from '../scheduling.js';

/**
 * Handle waitTime node: calculate next_run_at with schedule (NO JITTER)
 * 
 * Wait nodes should wait the exact duration specified. Jitter is NOT applied here.
 * Jitter is only applied when scheduling EMAIL sends to avoid patterns.
 * 
 * @param enrollment - The enrollment being processed
 * @param node - The waitTime node from the flow
 * @param schedule - Campaign schedule configuration (null if no schedule)
 * @param supabase - Supabase client
 * @returns Updated enrollment next_run_at
 */
export async function handleWaitTimeNode(
  enrollment: Enrollment,
  node: any,
  schedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<void> {
  // 1. Extract wait duration from node.node_data (canonical: wait_duration_seconds set by builder)
  // Fallback: duration_seconds, or legacy duration+unit for nodes saved before we set wait_duration_seconds
  const raw = node.node_data || {};
  let waitDurationSeconds = Number(raw.wait_duration_seconds) || Number(raw.duration_seconds) || 0;
  if (waitDurationSeconds <= 0 && raw.duration != null && String(raw.duration).trim() !== '') {
    const n = parseInt(String(raw.duration), 10);
    const unit = raw.unit || 'hours';
    if (!Number.isNaN(n) && n >= 0) {
      const multipliers: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
      waitDurationSeconds = n * (multipliers[unit] ?? 3600);
    }
  }

  if (waitDurationSeconds <= 0) {
    // No wait (or invalid): advance immediately so flow continues
    const nextRunAt = new Date().toISOString();
    const { error } = await supabase
      .from('enrollments')
      .update({
        current_node_id: node.id,
        next_run_at: nextRunAt,
      })
      .eq('id', enrollment.id);
    if (error) throw new Error(`Failed to update enrollment ${enrollment.id}: ${error.message}`);
    return;
  }

  // 2. Calculate base next_run_at from enrollment's updated_at (when enrollment was claimed/processed)
  // This ensures sequential wait nodes build on each other correctly
  // Use updated_at as it reflects when the enrollment was last processed
  const baseTime = new Date(enrollment.updated_at);
  const baseNextRunAt = new Date(baseTime.getTime() + waitDurationSeconds * 1000);

  // 3. Apply campaign schedule (NO JITTER - wait times should be exact)
  let nextRunAt: string;
  try {
    nextRunAt = calculateNextRunAt(baseNextRunAt, schedule);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error calculating scheduled time for wait node ${node.id} (enrollment ${enrollment.id}):`, errorMessage);
    // TODO: Send to Slack error reporting channel - Schedule calculation error
    // Fallback: Use base time + wait duration (no schedule)
    nextRunAt = baseNextRunAt.toISOString();
  }

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

