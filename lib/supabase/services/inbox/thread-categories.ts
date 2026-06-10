import { supabase } from '../../client';

/**
 * Update thread category (user override).
 * Syncs to the replied event's event_data.is_positive and campaign_stats.positive_reply_count.
 */
export async function updateThreadCategory(
  threadId: string,
  category: string | null
): Promise<void> {
  const { data: thread, error: fetchError } = await supabase
    .from('email_threads')
    .select('campaign_id, message_job_id, category')
    .eq('id', threadId)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch thread: ${fetchError.message}`);

  const previousPositive = thread?.category === 'Interested';
  const nextPositive = category === 'Interested';

  const { error } = await supabase
    .from('email_threads')
    .update({
      category: category ?? null,
      category_source: category ? 'user' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);

  if (error) throw new Error(`Failed to update thread category: ${error.message}`);

  if (thread?.campaign_id && thread?.message_job_id) {
    const { error: eventError } = await supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: thread.campaign_id,
      p_message_job_id: thread.message_job_id,
      p_is_positive: nextPositive,
    });
    if (eventError) {
      console.error('[updateThreadCategory] Failed to sync is_positive to event:', eventError);
    }
    const delta = nextPositive === previousPositive ? 0 : nextPositive ? 1 : -1;
    if (delta !== 0) {
      const { error: statsError } = await supabase.rpc('update_campaign_stats_positive_reply', {
        p_campaign_id: thread.campaign_id,
        p_delta: delta,
      });
      if (statsError) {
        console.error('[updateThreadCategory] Failed to adjust campaign_stats positive_reply_count:', statsError);
      }
    }
  }

  // Manual categorization is a wake event for categorizer flows: if the
  // thread's enrollment is parked at a categorizer node (active,
  // next_run_at NULL), nudge it so the scheduler branches on this category.
  // No-op for non-campaign threads and non-categorizer flows.
  if (category && thread?.campaign_id) {
    const { error: wakeError } = await supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
    if (wakeError) {
      console.error('[updateThreadCategory] Failed to wake parked enrollment for thread:', wakeError);
    }
  }
}
