import { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignSchedule } from './types.js';

export interface CampaignInterval {
  id: string;
  campaign_id: string;
  interval_time: string;
  status: 'available' | 'locked' | 'scheduled' | 'completed';
}

const MIN_INTERVALS_AHEAD = 20;
const INTERVAL_MAINTENANCE_INTERVAL_MS = 60000; // 1 minute

/**
 * Maintain campaign intervals - ensure we have enough intervals ahead
 */
export async function maintainCampaignIntervals(
  supabase: SupabaseClient
): Promise<void> {
  // Get all active campaigns with sending_interval_seconds
  // Also get last_processed_interval_end for sequential processing
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, sending_interval_seconds, created_at, schedule, last_processed_interval_end')
    .not('sending_interval_seconds', 'is', null);
  
  if (error) {
    console.error('[INTERVAL MAINTENANCE] Error loading campaigns:', error);
    return;
  }
  
  if (!campaigns || campaigns.length === 0) {
    return;
  }
  
  console.log(`[INTERVAL MAINTENANCE] Maintaining intervals for ${campaigns.length} campaign(s)`);
  
  for (const campaign of campaigns) {
    try {
      await ensureCampaignIntervals(
        campaign.id,
        campaign.sending_interval_seconds,
        campaign.created_at,
        campaign.schedule as CampaignSchedule | null,
        campaign.last_processed_interval_end,
        MIN_INTERVALS_AHEAD,
        supabase
      );
    } catch (error) {
      console.error(`[INTERVAL MAINTENANCE] Error maintaining intervals for campaign ${campaign.id}:`, error);
    }
  }
}

/**
 * Ensure a campaign has enough intervals ahead
 * Respects last_processed_interval_end for sequential processing
 */
async function ensureCampaignIntervals(
  campaignId: string,
  intervalSeconds: number,
  campaignStartTime: string,
  schedule: CampaignSchedule | null,
  lastProcessedIntervalEnd: string | null,
  minIntervalsAhead: number,
  supabase: SupabaseClient
): Promise<void> {
  // Get latest interval for this campaign
  const { data: latestInterval, error: latestError } = await supabase
    .from('campaign_intervals')
    .select('interval_time')
    .eq('campaign_id', campaignId)
    .order('interval_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (latestError) {
    throw new Error(`Failed to get latest interval: ${latestError.message}`);
  }
  
  const now = new Date();
  
  // Determine where to start creating intervals from:
  // 1. Latest interval time (if exists) + interval_seconds
  // 2. Last processed interval end (if exists) - for sequential processing
  // 3. Campaign start time (if no intervals exist)
  // 4. Current time (don't create past intervals)
  // Use the maximum of these to ensure we create intervals after all of them
  const candidateStarts: Date[] = [now];
  
  if (latestInterval) {
    // Next interval should be interval_seconds after the latest
    candidateStarts.push(new Date(new Date(latestInterval.interval_time).getTime() + (intervalSeconds * 1000)));
  }
  
  if (lastProcessedIntervalEnd) {
    candidateStarts.push(new Date(lastProcessedIntervalEnd));
  }
  
  candidateStarts.push(new Date(campaignStartTime));
  
  // Use the maximum (latest) time as the starting point
  const startFrom = new Date(Math.max(...candidateStarts.map(d => d.getTime())));
  
  // Calculate how many intervals we have ahead from the start point
  const intervalsAhead = Math.floor(
    (startFrom.getTime() - now.getTime()) / (intervalSeconds * 1000)
  );
  
  if (intervalsAhead >= minIntervalsAhead) {
    return; // We have enough intervals
  }
  
  // Calculate how many intervals to create
  const intervalsToCreate = minIntervalsAhead - intervalsAhead + 5; // Add buffer
  
  // Create intervals starting from the calculated start point
  await createCampaignIntervals(
    campaignId,
    startFrom,
    intervalsToCreate,
    intervalSeconds,
    schedule,
    supabase
  );
}

/**
 * Create campaign intervals
 */
async function createCampaignIntervals(
  campaignId: string,
  startFrom: Date,
  count: number,
  intervalSeconds: number,
  schedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<void> {
  const intervals = [];
  let currentTime = new Date(startFrom);
  
  for (let i = 0; i < count; i++) {
    // Calculate interval time (singular time, not a range)
    let intervalTime = new Date(currentTime);
    
    // Apply schedule constraints if needed
    // TODO: Implement schedule constraint logic
    // For now, intervals are created at regular intervals
    
    intervals.push({
      campaign_id: campaignId,
      interval_time: intervalTime.toISOString(),
      status: 'available'
    });
    
    // Next interval is interval_seconds later
    currentTime = new Date(currentTime.getTime() + (intervalSeconds * 1000));
  }
  
  // Insert intervals (ignore conflicts for idempotency)
  const { error } = await supabase
    .from('campaign_intervals')
    .upsert(intervals, {
      onConflict: 'campaign_id,interval_time',
      ignoreDuplicates: true
    });
  
  if (error) {
    throw new Error(`Failed to create intervals: ${error.message}`);
  }
  
  console.log(`[INTERVAL MAINTENANCE] Created ${intervals.length} intervals for campaign ${campaignId.substring(0, 8)}`);
}

/**
 * Adjust interval time to fit within schedule
 * TODO: Implement schedule constraint logic
 */
function adjustIntervalTime(
  time: Date,
  schedule: CampaignSchedule
): Date {
  // TODO: Implement schedule constraint logic
  // For now, return as-is
  // In future: adjust to fit within schedule windows
  return time;
}

