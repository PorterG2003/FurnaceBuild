import type { ScheduleConfig, SchedulePreset } from './types';

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
