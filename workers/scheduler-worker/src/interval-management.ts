import {
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignSchedule } from './types.js';
import { isWithinSchedule, calculateNextAllowedTime } from './scheduling.js';

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
  // Also get last_completed_interval_time for sequential processing
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, account_id, sending_interval_seconds, created_at, schedule, last_completed_interval_time')
    .eq('status', 'running')
    .not('sending_interval_seconds', 'is', null);
  
  if (error) {
    console.error('[INTERVAL MAINTENANCE] Error loading campaigns:', error);
    reportErrorToSlack('Scheduler: interval maintenance failed to load campaigns', {
      severity: 'warning',
      error: error.message,
      alertPolicy: isRetryableSupabaseReadError(error.message)
        ? 'transient_retryable_warning'
        : 'persistent_config_warning',
      aggregationKey: 'scheduler-interval-maintenance-load-campaigns',
      summaryFields: {
        worker: 'scheduler',
        operation: 'maintainCampaignIntervals',
      },
    });
    return;
  }
  
  if (!campaigns || campaigns.length === 0) {
    return;
  }
  
  console.log(`[INTERVAL MAINTENANCE] Maintaining intervals for ${campaigns.length} campaign(s)`);
  
  for (const campaign of campaigns) {
    try {
      console.log(`[INTERVAL MAINTENANCE] Processing campaign ${campaign.id.substring(0, 8)} (last_completed: ${campaign.last_completed_interval_time || 'NULL'})`);
      await ensureCampaignIntervals(
        campaign.id,
        campaign.account_id,
        campaign.sending_interval_seconds,
        campaign.created_at,
        campaign.schedule as CampaignSchedule | null,
        campaign.last_completed_interval_time,
        MIN_INTERVALS_AHEAD,
        supabase
      );
    } catch (error) {
      console.error(`[INTERVAL MAINTENANCE] Error maintaining intervals for campaign ${campaign.id}:`, error);
      const msg = error instanceof Error ? error.message : String(error);
      reportErrorToSlack('Scheduler: interval maintenance failed for campaign', {
        severity: 'warning',
        campaign_id: campaign.id,
        error: msg,
        alertPolicy: isRetryableSupabaseReadError(msg)
          ? 'transient_retryable_warning'
          : 'persistent_config_warning',
        aggregationKey: `scheduler-interval-maintenance-campaign:${campaign.id}`,
        summaryFields: {
          campaign_id: campaign.id,
        },
      });
    }
  }
}

/**
 * Ensure a campaign has enough intervals ahead
 * Respects last_completed_interval_time for sequential processing
 */
async function ensureCampaignIntervals(
  campaignId: string,
  accountId: string | null,
  intervalSeconds: number,
  campaignStartTime: string,
  schedule: CampaignSchedule | null,
  lastCompletedIntervalTime: string | null,
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
  // 2. Last completed interval time (if exists) - for sequential processing
  // 3. Campaign start time (if no intervals exist)
  // 4. Current time (don't create past intervals)
  // Use the maximum of these to ensure we create intervals after all of them
  const candidateStarts: Date[] = [now];
  
  if (latestInterval) {
    // Next interval should be interval_seconds after the latest
    candidateStarts.push(new Date(new Date(latestInterval.interval_time).getTime() + (intervalSeconds * 1000)));
  }
  
  if (lastCompletedIntervalTime) {
    candidateStarts.push(new Date(lastCompletedIntervalTime));
  }
  
  candidateStarts.push(new Date(campaignStartTime));
  
  // Use the maximum (latest) time as the starting point
  const startFrom = new Date(Math.max(...candidateStarts.map(d => d.getTime())));
  
  // Calculate how many intervals we have ahead from the start point
  const intervalsAhead = Math.floor(
    (startFrom.getTime() - now.getTime()) / (intervalSeconds * 1000)
  );
  
  if (intervalsAhead >= minIntervalsAhead) {
    console.log(`[INTERVAL MAINTENANCE] Campaign ${campaignId.substring(0, 8)}: Has ${intervalsAhead} intervals ahead (min: ${minIntervalsAhead}), no creation needed`);
    return; // We have enough intervals
  }
  
  // Calculate how many intervals to create
  const intervalsToCreate = minIntervalsAhead - intervalsAhead + 5; // Add buffer
  
  console.log(`[INTERVAL MAINTENANCE] Campaign ${campaignId.substring(0, 8)}: Only ${intervalsAhead} intervals ahead (min: ${minIntervalsAhead}), creating ${intervalsToCreate} starting from ${startFrom.toISOString()}`);
  
  // Create intervals starting from the calculated start point
  await createCampaignIntervals(
    campaignId,
    accountId,
    startFrom,
    intervalsToCreate,
    intervalSeconds,
    schedule,
    supabase
  );
}

/**
 * Create campaign intervals
 * Respects campaign schedule - only creates intervals within allowed schedule windows
 */
async function createCampaignIntervals(
  campaignId: string,
  accountId: string | null,
  startFrom: Date,
  count: number,
  intervalSeconds: number,
  schedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<void> {
  if (!accountId) {
    throw new Error(`Campaign ${campaignId} is missing account_id`);
  }

  const intervals: { campaign_id: string; account_id: string; interval_time: string; status: string }[] = [];
  let currentTime = new Date(startFrom);
  
  // If schedule exists, start from the next allowed time
  if (schedule) {
    currentTime = calculateNextAllowedTime(currentTime, schedule);
  }
  
  // Create intervals, only creating ones that fall within the schedule
  // Intervals are spaced by intervalSeconds, but we skip ones outside schedule windows
  let intervalsCreated = 0;
  const maxAttempts = count * 20; // Prevent infinite loops (e.g., if schedule has no valid days)
  let attempts = 0;
  
  while (intervalsCreated < count && attempts < maxAttempts) {
    attempts++;
    
    // Check if current time is within schedule
    if (schedule && !isWithinSchedule(currentTime, schedule)) {
      // Not within schedule - skip this interval and move to next candidate
      // Calculate next allowed time, but then continue adding intervalSeconds from there
      const nextAllowed = calculateNextAllowedTime(currentTime, schedule);
      // If next allowed time is more than one interval away, we might skip multiple intervals
      // But we want to maintain spacing, so just move to next interval_seconds candidate
      currentTime = new Date(currentTime.getTime() + (intervalSeconds * 1000));
      continue;
    }
    
    // Interval is valid (either no schedule or within schedule) - create it
    intervals.push({
      campaign_id: campaignId,
      account_id: accountId,
      interval_time: currentTime.toISOString(),
      status: 'available'
    });
    
    intervalsCreated++;
    
    // Next interval is interval_seconds later
    currentTime = new Date(currentTime.getTime() + (intervalSeconds * 1000));
  }
  
  if (intervalsCreated < count) {
    console.warn(`[INTERVAL MAINTENANCE] Campaign ${campaignId.substring(0, 8)}: Only created ${intervalsCreated} of ${count} requested intervals (schedule constraints or max attempts reached)`);
  }
  
  if (intervals.length === 0) {
    console.warn(`[INTERVAL MAINTENANCE] Campaign ${campaignId.substring(0, 8)}: No intervals created (possibly no valid schedule windows)`);
    return;
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

