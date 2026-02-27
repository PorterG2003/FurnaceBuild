import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import type { CampaignSchedule } from './types.js';

/**
 * Check if a given time is within the campaign schedule
 */
export function isWithinSchedule(
  time: Date,
  schedule: CampaignSchedule
): boolean {
  try {
    // Validate schedule structure
    if (!schedule.timezone || typeof schedule.start_hour !== 'number' || typeof schedule.end_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      reportErrorToSlack('Invalid schedule configuration (missing timezone or hours)', { severity: 'warning' });
      return true; // Default to allowing if schedule is invalid (fail open)
    }

    // Convert time to campaign timezone
    const zonedTime = toZonedTime(time, schedule.timezone);
    const hour = zonedTime.getHours();
    const dayOfWeek = zonedTime.getDay(); // 0 = Sunday, 6 = Saturday

    // Check if within hours
    if (hour < schedule.start_hour || hour >= schedule.end_hour) {
      return false;
    }

    // Check if day is allowed
    if (schedule.days_of_week && schedule.days_of_week.length > 0) {
      if (!schedule.days_of_week.includes(dayOfWeek)) {
        return false;
      }
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error checking schedule (timezone: ${schedule.timezone}):`, errorMessage);
    reportErrorToSlack('Timezone conversion error in isWithinSchedule', {
      severity: 'warning',
      timezone: schedule.timezone,
      error: errorMessage,
    });
    return true; // Default to allowing if timezone conversion fails (fail open)
  }
}

/**
 * Calculate the next allowed time based on campaign schedule
 * Returns the earliest time that satisfies the schedule constraints
 */
export function calculateNextAllowedTime(
  baseTime: Date,
  schedule: CampaignSchedule
): Date {
  try {
    // Validate schedule structure
    if (!schedule.timezone || typeof schedule.start_hour !== 'number' || typeof schedule.end_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      reportErrorToSlack('Invalid schedule configuration in calculateNextAllowedTime', { severity: 'warning' });
      return baseTime; // Return base time if schedule is invalid
    }

    // Convert base time to campaign timezone
    const zonedTime = toZonedTime(baseTime, schedule.timezone);
    const hour = zonedTime.getHours();
    const dayOfWeek = zonedTime.getDay();
    const minutes = zonedTime.getMinutes();
    const seconds = zonedTime.getSeconds();
    const milliseconds = zonedTime.getMilliseconds();

    // Create a new date in the campaign timezone
    let nextTime = new Date(zonedTime);

    // Check if we need to move to a different day
    let needsDayAdjustment = false;
    if (schedule.days_of_week && schedule.days_of_week.length > 0) {
      if (!schedule.days_of_week.includes(dayOfWeek)) {
        needsDayAdjustment = true;
      }
    }

    // Check if we need to move to a different hour
    let needsHourAdjustment = false;
    if (hour < schedule.start_hour) {
      // Before start hour - move to start hour today
      needsHourAdjustment = true;
    } else if (hour >= schedule.end_hour) {
      // After end hour - move to start hour next day
      needsHourAdjustment = true;
      needsDayAdjustment = true;
    }

    // Adjust hour if needed
    if (needsHourAdjustment) {
      nextTime.setHours(schedule.start_hour, 0, 0, 0);
    }

    // Adjust day if needed
    if (needsDayAdjustment) {
      // Find next allowed day
      if (schedule.days_of_week && schedule.days_of_week.length > 0) {
        // Sort days of week
        const sortedDays = [...schedule.days_of_week].sort((a, b) => a - b);
        
        // Find next day in the sorted list
        let nextDay = sortedDays.find(day => day > dayOfWeek);
        
        if (!nextDay) {
          // No day found this week, use first day of next week
          nextDay = sortedDays[0];
          // Add 7 days to get to next week
          nextTime.setDate(nextTime.getDate() + (7 - dayOfWeek + nextDay));
        } else {
          // Found day this week
          nextTime.setDate(nextTime.getDate() + (nextDay - dayOfWeek));
        }
        
        // Set to start hour
        nextTime.setHours(schedule.start_hour, 0, 0, 0);
      } else {
        // No day restrictions, just move to next day if we're past end hour
        if (hour >= schedule.end_hour) {
          nextTime.setDate(nextTime.getDate() + 1);
          nextTime.setHours(schedule.start_hour, 0, 0, 0);
        }
      }
    }

    // Convert back to UTC
    // nextTime is already in the campaign timezone, convert it back to UTC
    return fromZonedTime(nextTime, schedule.timezone);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error calculating next allowed time (timezone: ${schedule.timezone}):`, errorMessage);
    reportErrorToSlack('Timezone calculation error in calculateNextAllowedTime', {
      severity: 'warning',
      timezone: schedule.timezone,
      error: errorMessage,
    });
    return new Date(baseTime.getTime() + 3600000);
  }
}

/**
 * Apply jitter to a scheduled time
 * Jitter is a random offset within the jitter percentage range
 */
export function applyJitter(
  scheduledTime: Date,
  baseTime: Date,
  jitterPercentage: number
): Date {
  if (jitterPercentage <= 0) {
    return scheduledTime;
  }

  // Calculate time difference in milliseconds
  const timeDiff = scheduledTime.getTime() - baseTime.getTime();
  
  // Calculate jitter range (percentage of time difference)
  const jitterRange = Math.abs(timeDiff) * (jitterPercentage / 100);
  
  // Generate random jitter between -jitterRange and +jitterRange
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random between -1 and 1
  
  // Apply jitter
  const jitteredTime = new Date(scheduledTime.getTime() + jitter);
  
  // Ensure jittered time is not before base time
  if (jitteredTime.getTime() < baseTime.getTime()) {
    return baseTime;
  }
  
  return jitteredTime;
}

/**
 * Calculate when an enrollment should run next (for wait nodes)
 * 
 * This function:
 * 1. Starts with a base time (usually NOW() + wait duration)
 * 2. Applies campaign schedule constraints (timezone, hours, days)
 * 3. Does NOT apply jitter (wait times should be exact)
 * 
 * @param baseTime - Base time to schedule from (usually current time + wait duration)
 * @param schedule - Campaign schedule configuration (null if no schedule)
 * @returns ISO string of next run time
 */
export function calculateNextRunAt(
  baseTime: Date,
  schedule: CampaignSchedule | null
): string {
  let nextRunTime = new Date(baseTime);

  // Apply campaign schedule if it exists
  if (schedule) {
    if (isWithinSchedule(nextRunTime, schedule)) {
      // Already within schedule, use as-is
    } else {
      // Outside schedule, calculate next allowed time
      nextRunTime = calculateNextAllowedTime(baseTime, schedule);
    }
  }

  // NO JITTER - wait times should be exact
  return nextRunTime.toISOString();
}

/**
 * Calculate when a message should be scheduled to send
 * 
 * This function:
 * 1. Starts with a base time (usually NOW())
 * 2. Applies campaign schedule constraints (timezone, hours, days)
 * 3. Applies jitter (random delay to avoid patterns)
 * 
 * Jitter is applied to EMAIL sends to avoid patterns (e.g., all emails at 9:00 AM).
 * Jitter is NOT applied to wait nodes - they should wait the exact duration.
 * 
 * @param baseTime - Base time to schedule from (usually current time)
 * @param schedule - Campaign schedule configuration (null if no schedule)
 * @param jitterPercentage - Jitter percentage (0-100, default 10)
 * @returns ISO string of scheduled time
 */
export function calculateScheduledAt(
  baseTime: Date,
  schedule: CampaignSchedule | null,
  jitterPercentage: number = 10
): string {
  let scheduledTime = new Date(baseTime);

  // Apply campaign schedule if it exists
  if (schedule) {
    if (isWithinSchedule(scheduledTime, schedule)) {
      // Already within schedule, use as-is
    } else {
      // Outside schedule, calculate next allowed time
      scheduledTime = calculateNextAllowedTime(baseTime, schedule);
    }
  }

  // Apply jitter (only for email sends, not for wait nodes)
  scheduledTime = applyJitter(scheduledTime, baseTime, jitterPercentage);

  return scheduledTime.toISOString();
}

/**
 * Find the most recent schedule start time
 * Returns the most recent time when the schedule window started
 * For example, if schedule is 9 AM - 5 PM and current time is 2 PM:
 * - Most recent schedule start = 9 AM today
 */
function findMostRecentScheduleStart(currentTime: Date, schedule: CampaignSchedule): Date {
  try {
    // Validate schedule structure
    if (!schedule.timezone || typeof schedule.start_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      return currentTime; // Fallback to current time
    }

    const scheduleStartHour = schedule.start_hour || 0;
    const scheduleStartMinute = 0; // Schedule doesn't have start_minute in current schema

    // Convert current time to schedule timezone
    const tz = schedule.timezone || 'UTC';
    const currentInTz = toZonedTime(currentTime, tz);

    // Create date for today at schedule start time
    const todayStart = new Date(currentInTz);
    todayStart.setHours(scheduleStartHour, scheduleStartMinute, 0, 0);

    // If today's start is in the past or equal, use it
    if (todayStart <= currentInTz) {
      return fromZonedTime(todayStart, tz);
    } else {
      // Use yesterday's start (or previous matching day if days_of_week specified)
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      
      // If days_of_week is specified, find the most recent matching day
      if (schedule.days_of_week && schedule.days_of_week.length > 0) {
        const sortedDays = [...schedule.days_of_week].sort((a, b) => b - a); // Descending
        const currentDay = currentInTz.getDay();
        
        // Find the most recent matching day
        let mostRecentDay = sortedDays.find(day => day <= currentDay);
        if (!mostRecentDay) {
          // No day found this week, use last day of previous week
          mostRecentDay = sortedDays[0];
          yesterdayStart.setDate(yesterdayStart.getDate() - (currentDay - mostRecentDay + 7));
        } else {
          yesterdayStart.setDate(yesterdayStart.getDate() - (currentDay - mostRecentDay));
        }
      }
      
      return fromZonedTime(yesterdayStart, tz);
    }
  } catch (error) {
    console.error('Error finding most recent schedule start:', error);
    return currentTime; // Fallback to current time
  }
}

/**
 * Calculate the next base time for scheduling a message from this mailbox
 * 
 * This function uses a slot-based approach:
 * - If no schedule: (roundDown((Current time - Campaign start time) / interval) * interval) + interval
 * - If schedule: (roundDown((Current time - Most recent schedule start) / interval) * interval) + interval
 * 
 * Then enforces mailbox minimum gap to prevent scheduling too many messages too close together.
 * 
 * @param campaignId - Campaign ID
 * @param mailboxId - Mailbox ID
 * @param currentTime - Current time
 * @param campaignSchedule - Campaign schedule (null if no schedule)
 * @param supabase - Supabase client
 * @returns Next base time for scheduling
 */
export async function calculateNextMailboxSendTime(
  campaignId: string,
  mailboxId: string,
  currentTime: Date,
  campaignSchedule: CampaignSchedule | null,
  supabase: SupabaseClient
): Promise<Date> {
  // Step 1: Load Campaign Interval and Start Time
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('sending_interval_seconds, created_at')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Campaign ${campaignId} not found: ${campaignError?.message || 'Campaign not found'}`);
  }

  const intervalSeconds = campaign.sending_interval_seconds;
  const campaignStartTime = new Date(campaign.created_at);

  // Step 2: Validate Interval Exists
  if (!intervalSeconds || intervalSeconds <= 0) {
    throw new Error(`Campaign ${campaignId} does not have a valid sending_interval_seconds configured`);
  }

  // Step 3: Calculate Campaign Interval Base Time (Slot-Based)
  let campaignIntervalBaseTime: Date;

  if (!campaignSchedule) {
    // No schedule constraints - calculate slot from campaign start time
    // Formula: (roundDown((Current time - Campaign start time) / interval) * interval) + interval
    const timeSinceStart = currentTime.getTime() - campaignStartTime.getTime();
    const intervalsElapsed = Math.floor(timeSinceStart / (intervalSeconds * 1000));
    const nextSlotTime = campaignStartTime.getTime() + ((intervalsElapsed + 1) * intervalSeconds * 1000);
    campaignIntervalBaseTime = new Date(nextSlotTime);
  } else {
    // Campaign has schedule constraints - calculate slot from most recent schedule start
    const mostRecentScheduleStart = findMostRecentScheduleStart(currentTime, campaignSchedule);
    
    // Calculate slot-based time
    const timeSinceScheduleStart = currentTime.getTime() - mostRecentScheduleStart.getTime();
    const intervalsElapsed = Math.floor(timeSinceScheduleStart / (intervalSeconds * 1000));
    const nextSlotTime = mostRecentScheduleStart.getTime() + ((intervalsElapsed + 1) * intervalSeconds * 1000);
    const slotBasedTime = new Date(nextSlotTime);
    
    // Ensure the slot-based time is within the current schedule window
    // If it's outside, find the next allowed time in schedule
    try {
      campaignIntervalBaseTime = calculateNextAllowedTime(slotBasedTime, campaignSchedule);
    } catch (error) {
      throw new Error(`Failed to calculate next allowed time for schedule: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 4: Query Mailbox Minimum Gap
  const { data: throttle, error: throttleError } = await supabase
    .from('mailbox_throttles')
    .select('min_gap_seconds')
    .eq('mailbox_id', mailboxId)
    .eq('date', new Date().toISOString().split('T')[0]) // Today's date
    .maybeSingle();

  if (throttleError) {
    throw new Error(`Failed to query mailbox throttle for mailbox ${mailboxId}: ${throttleError.message}`);
  }

  // Get minimum gap (default to 180 seconds if not configured)
  const minGapSeconds = throttle?.min_gap_seconds ?? 180;

  // Step 5: Query Last Mailbox Scheduled Time (For Minimum Gap Enforcement)
  const { data: lastJob, error: queryError } = await supabase
    .from('message_jobs')
    .select('scheduled_at')
    .eq('campaign_id', campaignId)
    .eq('mailbox_id', mailboxId)
    .in('status', ['pending', 'reserved', 'sending', 'sent']) // Count scheduled and sent messages
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (queryError) {
    throw new Error(`Failed to query last scheduled time for mailbox ${mailboxId} in campaign ${campaignId}: ${queryError.message}`);
  }

  const lastScheduledTime = lastJob?.scheduled_at ? new Date(lastJob.scheduled_at) : null;

  // Step 6: Calculate Minimum Time (Mailbox Gap Enforcement)
  let mailboxMinTime: Date;

  if (!lastScheduledTime) {
    // No previous scheduled messages from this mailbox - use campaign interval base time
    mailboxMinTime = campaignIntervalBaseTime;
  } else {
    // Previous scheduled messages exist from this mailbox - must wait at least min_gap_seconds after last scheduled time
    mailboxMinTime = new Date(lastScheduledTime.getTime() + (minGapSeconds * 1000));
    
    // Ensure mailboxMinTime is not in the past (shouldn't happen - indicates data inconsistency)
    if (mailboxMinTime < currentTime) {
      throw new Error(`Calculated mailboxMinTime (${mailboxMinTime}) is in the past. Last scheduled: ${lastScheduledTime}, Min gap: ${minGapSeconds}s, Current: ${currentTime}`);
    }
  }

  // Step 7: Calculate Final Base Time
  // Use whichever is later: campaign interval base time or mailbox minimum gap time
  let baseTime = campaignIntervalBaseTime > mailboxMinTime ? campaignIntervalBaseTime : mailboxMinTime;

  // Final validation: ensure baseTime is not in the past
  // If calculated time is in the past, use currentTime instead
  if (baseTime < currentTime) {
    baseTime = currentTime;
  }

  return baseTime;
}

