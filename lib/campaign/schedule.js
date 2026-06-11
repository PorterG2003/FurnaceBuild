import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { reportErrorToSlack } from '@furnace/slack-lib';

export function isWithinSchedule(time, schedule) {
  try {
    if (!schedule.timezone || typeof schedule.start_hour !== 'number' || typeof schedule.end_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      reportErrorToSlack('Invalid schedule configuration (missing timezone or hours)', { severity: 'warning' });
      return true;
    }

    const zonedTime = toZonedTime(time, schedule.timezone);
    const hour = zonedTime.getHours();
    const dayOfWeek = zonedTime.getDay();

    if (hour < schedule.start_hour || hour >= schedule.end_hour) {
      return false;
    }

    if (schedule.days_of_week && schedule.days_of_week.length > 0 && !schedule.days_of_week.includes(dayOfWeek)) {
      return false;
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
    return true;
  }
}

export function calculateNextAllowedTime(baseTime, schedule) {
  try {
    if (!schedule.timezone || typeof schedule.start_hour !== 'number' || typeof schedule.end_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      reportErrorToSlack('Invalid schedule configuration in calculateNextAllowedTime', { severity: 'warning' });
      return baseTime;
    }

    const zonedTime = toZonedTime(baseTime, schedule.timezone);
    const hour = zonedTime.getHours();
    const dayOfWeek = zonedTime.getDay();

    let nextTime = new Date(zonedTime);
    let needsDayAdjustment = false;

    if (schedule.days_of_week && schedule.days_of_week.length > 0 && !schedule.days_of_week.includes(dayOfWeek)) {
      needsDayAdjustment = true;
    }

    let needsHourAdjustment = false;
    if (hour < schedule.start_hour) {
      needsHourAdjustment = true;
    } else if (hour >= schedule.end_hour) {
      needsHourAdjustment = true;
      needsDayAdjustment = true;
    }

    if (needsHourAdjustment) {
      nextTime.setHours(schedule.start_hour, 0, 0, 0);
    }

    if (needsDayAdjustment) {
      if (schedule.days_of_week && schedule.days_of_week.length > 0) {
        const sortedDays = [...schedule.days_of_week].sort((a, b) => a - b);
        let nextDay = sortedDays.find((day) => day > dayOfWeek);

        if (!nextDay && sortedDays.length > 0) {
          nextDay = sortedDays[0];
          nextTime.setDate(nextTime.getDate() + (7 - dayOfWeek + nextDay));
        } else if (nextDay !== undefined) {
          nextTime.setDate(nextTime.getDate() + (nextDay - dayOfWeek));
        }

        nextTime.setHours(schedule.start_hour, 0, 0, 0);
      } else if (hour >= schedule.end_hour) {
        nextTime.setDate(nextTime.getDate() + 1);
        nextTime.setHours(schedule.start_hour, 0, 0, 0);
      }
    }

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

export function applyJitter(scheduledTime, baseTime, jitterPercentage) {
  if (jitterPercentage <= 0) {
    return scheduledTime;
  }

  const timeDiff = scheduledTime.getTime() - baseTime.getTime();
  const jitterRange = Math.abs(timeDiff) * (jitterPercentage / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  const jitteredTime = new Date(scheduledTime.getTime() + jitter);

  if (jitteredTime.getTime() < baseTime.getTime()) {
    return baseTime;
  }

  return jitteredTime;
}

export function calculateNextRunAt(baseTime, schedule) {
  let nextRunTime = new Date(baseTime);

  if (schedule && !isWithinSchedule(nextRunTime, schedule)) {
    nextRunTime = calculateNextAllowedTime(baseTime, schedule);
  }

  return nextRunTime.toISOString();
}

export function calculateScheduledAt(baseTime, schedule, jitterPercentage = 10) {
  let scheduledTime = new Date(baseTime);

  if (schedule) {
    if (!isWithinSchedule(scheduledTime, schedule)) {
      scheduledTime = calculateNextAllowedTime(baseTime, schedule);
    }
  }

  scheduledTime = applyJitter(scheduledTime, baseTime, jitterPercentage);
  return scheduledTime.toISOString();
}

export function findMostRecentScheduleStart(currentTime, schedule) {
  try {
    if (!schedule.timezone || typeof schedule.start_hour !== 'number') {
      console.error('Invalid schedule structure:', schedule);
      return currentTime;
    }

    const scheduleStartHour = schedule.start_hour || 0;
    const scheduleStartMinute = 0;
    const tz = schedule.timezone || 'UTC';
    const currentInTz = toZonedTime(currentTime, tz);

    const todayStart = new Date(currentInTz);
    todayStart.setHours(scheduleStartHour, scheduleStartMinute, 0, 0);

    if (todayStart <= currentInTz) {
      return fromZonedTime(todayStart, tz);
    }

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    if (schedule.days_of_week && schedule.days_of_week.length > 0) {
      const sortedDays = [...schedule.days_of_week].sort((a, b) => b - a);
      const currentDay = currentInTz.getDay();

      let mostRecentDay = sortedDays.find((day) => day <= currentDay);
      if (!mostRecentDay) {
        mostRecentDay = sortedDays[0];
        yesterdayStart.setDate(yesterdayStart.getDate() - (currentDay - mostRecentDay + 7));
      } else {
        yesterdayStart.setDate(yesterdayStart.getDate() - (currentDay - mostRecentDay));
      }
    }

    return fromZonedTime(yesterdayStart, tz);
  } catch (error) {
    console.error('Error finding most recent schedule start:', error);
    return currentTime;
  }
}
