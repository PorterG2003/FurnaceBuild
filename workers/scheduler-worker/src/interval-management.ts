import { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignSchedule } from './types.js';

export interface CampaignInterval {
  id: string;
  campaign_id: string;
  interval_start: string;
  interval_end: string;
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
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, sending_interval_seconds, created_at, schedule')
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
 */
async function ensureCampaignIntervals(
  campaignId: string,
  intervalSeconds: number,
  campaignStartTime: string,
  schedule: CampaignSchedule | null,
  minIntervalsAhead: number,
  supabase: SupabaseClient
): Promise<void> {
  // Get latest interval for this campaign
  const { data: latestInterval, error: latestError } = await supabase
    .from('campaign_intervals')
    .select('interval_end')
    .eq('campaign_id', campaignId)
    .order('interval_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (latestError) {
    throw new Error(`Failed to get latest interval: ${latestError.message}`);
  }
  
  const now = new Date();
  const latestEnd = latestInterval 
    ? new Date(latestInterval.interval_end)
    : new Date(campaignStartTime);
  
  // Calculate how many intervals we have ahead
  const intervalsAhead = Math.floor(
    (latestEnd.getTime() - now.getTime()) / (intervalSeconds * 1000)
  );
  
  if (intervalsAhead >= minIntervalsAhead) {
    return; // We have enough intervals
  }
  
  // Calculate how many intervals to create
  const intervalsToCreate = minIntervalsAhead - intervalsAhead + 5; // Add buffer
  
  // Create intervals
  await createCampaignIntervals(
    campaignId,
    latestEnd,
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
  let currentStart = new Date(startFrom);
  
  for (let i = 0; i < count; i++) {
    // Calculate interval boundaries
    let intervalStart = new Date(currentStart);
    let intervalEnd = new Date(currentStart.getTime() + (intervalSeconds * 1000));
    
    // Apply schedule constraints if needed
    if (schedule) {
      const adjusted = adjustIntervalForSchedule(
        intervalStart,
        intervalEnd,
        schedule
      );
      intervalStart = adjusted.start;
      intervalEnd = adjusted.end;
    }
    
    intervals.push({
      campaign_id: campaignId,
      interval_start: intervalStart.toISOString(),
      interval_end: intervalEnd.toISOString(),
      status: 'available'
    });
    
    currentStart = intervalEnd;
  }
  
  // Insert intervals (ignore conflicts for idempotency)
  const { error } = await supabase
    .from('campaign_intervals')
    .upsert(intervals, {
      onConflict: 'campaign_id,interval_start',
      ignoreDuplicates: true
    });
  
  if (error) {
    throw new Error(`Failed to create intervals: ${error.message}`);
  }
  
  console.log(`[INTERVAL MAINTENANCE] Created ${intervals.length} intervals for campaign ${campaignId.substring(0, 8)}`);
}

/**
 * Adjust interval boundaries to fit within schedule
 * TODO: Implement schedule constraint logic
 */
function adjustIntervalForSchedule(
  start: Date,
  end: Date,
  schedule: CampaignSchedule
): { start: Date, end: Date } {
  // TODO: Implement schedule constraint logic
  // For now, return as-is
  // In future: adjust to fit within schedule windows
  return { start, end };
}

