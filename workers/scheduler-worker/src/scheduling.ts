import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
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
      // TODO: Send to Slack error reporting channel - Invalid schedule configuration
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
    // TODO: Send to Slack error reporting channel - Timezone conversion error
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
      // TODO: Send to Slack error reporting channel - Invalid schedule configuration
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
    // TODO: Send to Slack error reporting channel - Timezone calculation error
    // Return base time + 1 hour as fallback
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

