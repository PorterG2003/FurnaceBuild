import type { ScheduleConfig, SchedulePreset } from './types';
import { utcToZonedTime } from 'date-fns-tz';

/**
 * Generate test lead email and name based on index
 */
export function generateTestLead(index: number): { email: string; name: string } {
  return {
    email: `test-lead-${index}@furnace.test`,
    name: `Test Lead ${index}`,
  };
}

/**
 * Validate schedule configuration
 */
export function validateSchedule(schedule: ScheduleConfig): { valid: boolean; error?: string } {
  if (schedule.start_hour < 0 || schedule.start_hour > 23) {
    return { valid: false, error: 'Start hour must be between 0 and 23' };
  }

  if (schedule.end_hour < 0 || schedule.end_hour > 23) {
    return { valid: false, error: 'End hour must be between 0 and 23' };
  }

  if (schedule.start_minute < 0 || schedule.start_minute > 59) {
    return { valid: false, error: 'Start minute must be between 0 and 59' };
  }

  if (schedule.end_minute < 0 || schedule.end_minute > 59) {
    return { valid: false, error: 'End minute must be between 0 and 59' };
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: schedule.timezone });
  } catch (e) {
    return { valid: false, error: `Invalid timezone: ${schedule.timezone}` };
  }

  // Validate sending interval
  if (!schedule.sending_interval_seconds || schedule.sending_interval_seconds <= 0) {
    return { valid: false, error: 'Sending interval must be greater than 0 minutes' };
  }

  return { valid: true };
}

/**
 * Apply schedule preset to configuration
 */
export function applySchedulePreset(preset: SchedulePreset): ScheduleConfig {
  switch (preset) {
    case '24/7':
      return {
        timezone: 'America/New_York',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        sending_interval_seconds: 300,
      };
    case 'business-hours':
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
        sending_interval_seconds: 300,
      };
    case 'weekdays-only':
      return {
        timezone: 'America/New_York',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [1, 2, 3, 4, 5],
        sending_interval_seconds: 300,
      };
    case 'custom':
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
        sending_interval_seconds: 300,
      };
    default:
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
        sending_interval_seconds: 300,
      };
  }
}

/**
 * Check if current time is within schedule
 * Matches the logic from scheduler-worker/src/scheduling.ts but includes minutes for accuracy
 */
export function isWithinSchedule(schedule: {
  timezone: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  days_of_week: number[];
}): boolean {
  try {
    const now = new Date();
    const zonedTime = utcToZonedTime(now, schedule.timezone);
    
    // Check day of week (0 = Sunday, 1 = Monday, etc.)
    const dayOfWeek = zonedTime.getDay();
    if (schedule.days_of_week && schedule.days_of_week.length > 0) {
      if (!schedule.days_of_week.includes(dayOfWeek)) {
        return false;
      }
    }

    // Check time window (convert to minutes for accurate comparison)
    const hour = zonedTime.getHours();
    const minute = zonedTime.getMinutes();
    const currentTimeMinutes = hour * 60 + minute;
    
    const startTimeMinutes = schedule.start_hour * 60 + (schedule.start_minute || 0);
    const endTimeMinutes = schedule.end_hour * 60 + (schedule.end_minute || 0);

    // Handle 24/7 case (start = 0:00, end = 23:59)
    if (startTimeMinutes === 0 && endTimeMinutes >= 1439) {
      return true;
    }

    // Check if within time window (inclusive start, exclusive end to match scheduler worker)
    // The scheduler worker uses hour >= end_hour, so we use >= for end time
    return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
  } catch (error) {
    console.error('Error checking schedule:', error);
    return false;
  }
}
