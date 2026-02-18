import { utcToZonedTime } from 'date-fns-tz';

/**
 * Check if current time is within schedule
 * Matches the logic from scheduler-worker/src/scheduling.ts but includes minutes for accuracy
 */
export function isWithinSchedule(schedule: {
  timezone: string;
  start_hour: number;
  start_minute?: number;
  end_hour: number;
  end_minute?: number;
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
