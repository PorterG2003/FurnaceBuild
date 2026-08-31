import type { SupabaseClient } from '@supabase/supabase-js';

export const CAMPAIGN_SCHEDULE_DEFAULT_POLL_MS = 60_000;
export const CAMPAIGN_SCHEDULE_MIN_POLL_MS = 15_000;
export const CAMPAIGN_SCHEDULE_MAX_POLL_MS = 30 * 60 * 1000;
export const CAMPAIGN_SCHEDULE_RPC_BATCH_SIZE = 50;
export const CAMPAIGN_SCHEDULE_MAX_BATCHES = 20;

/** Mirrors interval parsing in SchedulerWorker.startCampaignScheduleProcessing. */
export function resolveCampaignSchedulePollIntervalMs(envValue: string | undefined): number {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) return CAMPAIGN_SCHEDULE_DEFAULT_POLL_MS;
  return Math.min(
    Math.max(Math.floor(parsed), CAMPAIGN_SCHEDULE_MIN_POLL_MS),
    CAMPAIGN_SCHEDULE_MAX_POLL_MS,
  );
}

export type CampaignScheduleTickResult = {
  processed: number;
  batches: number;
};

/**
 * Drain due campaign start/pause transitions via PostgREST RPC.
 * Continues while a batch returns at least `batchSize` rows, capped at maxBatches.
 */
export async function runCampaignScheduleTick(
  supabase: Pick<SupabaseClient, 'rpc'>,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<CampaignScheduleTickResult> {
  const batchSize = options.batchSize ?? CAMPAIGN_SCHEDULE_RPC_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? CAMPAIGN_SCHEDULE_MAX_BATCHES;
  let processed = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const { data, error } = await supabase.rpc('process_due_campaign_schedule_transitions', {
      p_batch_size: batchSize,
    });
    if (error) {
      throw error;
    }
    const n = typeof data === 'number' ? data : 0;
    processed += n;
    batches += 1;
    if (n < batchSize) {
      break;
    }
  }

  return { processed, batches };
}
