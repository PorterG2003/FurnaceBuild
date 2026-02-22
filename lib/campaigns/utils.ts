import { utcToZonedTime } from 'date-fns-tz';
import type { Campaign } from '@/lib/supabase/types';

export interface ScheduleShape {
  timezone: string;
  start_hour: number;
  start_minute?: number;
  end_hour: number;
  end_minute?: number;
  days_of_week: number[];
}

export const SCHEDULE_PRESETS = [
  { value: '24/7', label: '24/7 (No restrictions)' },
  { value: 'business-hours', label: 'Business hours (9–5 Mon–Fri, Central)' },
] as const;

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]['value'] | 'custom';

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
] as const;

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function scheduleFromCampaign(campaign: Campaign | null): ScheduleShape | null {
  if (!campaign?.schedule) return null;
  const s =
    typeof campaign.schedule === 'string'
      ? JSON.parse(campaign.schedule)
      : campaign.schedule;
  const sh = s as ScheduleShape;
  return {
    ...sh,
    start_minute: sh.start_minute ?? 0,
    end_minute: sh.end_minute ?? 0,
  };
}

export function applyPreset(preset: SchedulePreset): ScheduleShape {
  switch (preset) {
    case '24/7':
      return {
        timezone: 'America/New_York',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      };
    case 'business-hours':
      return {
        timezone: 'America/Chicago',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
      };
    default:
      return {
        timezone: 'America/New_York',
        start_hour: 9,
        start_minute: 0,
        end_hour: 17,
        end_minute: 0,
        days_of_week: [1, 2, 3, 4, 5],
      };
  }
}

export function formatHour12(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return minute === 0 ? `${h} ${ampm}` : `${h}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export function scheduleMatchesPreset(schedule: ScheduleShape | null, preset: SchedulePreset): boolean {
  if (!schedule || preset === 'custom') return false;
  const applied = applyPreset(preset as '24/7' | 'business-hours');
  return (
    schedule.timezone === applied.timezone &&
    schedule.start_hour === applied.start_hour &&
    (schedule.start_minute ?? 0) === (applied.start_minute ?? 0) &&
    schedule.end_hour === applied.end_hour &&
    (schedule.end_minute ?? 59) === (applied.end_minute ?? 59) &&
    schedule.days_of_week.length === applied.days_of_week.length &&
    schedule.days_of_week.every((d, i) => d === applied.days_of_week[i])
  );
}

export function calculateEmailsPerMailboxPerDay(schedule: ScheduleShape | null, intervalMinutes: number): string {
  if (!schedule || !intervalMinutes || intervalMinutes <= 0) return '—';
  const startMin = (schedule.start_hour ?? 0) * 60 + (schedule.start_minute ?? 0);
  const endMin = (schedule.end_hour ?? 0) * 60 + (schedule.end_minute ?? 0);
  let windowMinutes: number;
  if (startMin === 0 && endMin >= 1439 && (schedule.days_of_week?.length ?? 0) === 7) {
    windowMinutes = 24 * 60;
  } else if (endMin > startMin) {
    windowMinutes = endMin - startMin;
  } else if (endMin < startMin) {
    windowMinutes = 24 * 60 - startMin + endMin;
  } else {
    windowMinutes = (schedule.days_of_week?.length ?? 0) === 7 ? 24 * 60 : 0;
  }
  if (windowMinutes === 0) return '0';
  const intervalsPerWindow = Math.floor(windowMinutes / intervalMinutes);
  const daysCount = schedule.days_of_week?.length ?? 0;
  if (daysCount === 7) return `~${intervalsPerWindow} per mailbox per day`;
  const avgPerDay = Math.round((intervalsPerWindow * daysCount) / 7 * 100) / 100;
  return `~${intervalsPerWindow} per scheduled day (avg ${avgPerDay} per calendar day)`;
}

export function hasFlowBuilt(campaign: Campaign | null): boolean {
  if (!campaign?.flow_data) return false;
  try {
    const fd =
      typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
    const nodes = Array.isArray((fd as any)?.nodes) ? (fd as any).nodes : [];
    return nodes.length > 0;
  } catch {
    return false;
  }
}

export function getFlowNodeCount(campaign: Campaign | null): number {
  if (!campaign?.flow_data) return 0;
  try {
    const fd =
      typeof campaign.flow_data === 'string'
        ? JSON.parse(campaign.flow_data)
        : campaign.flow_data;
    const nodes = Array.isArray((fd as any)?.nodes) ? (fd as any).nodes : [];
    return nodes.filter((n: any) => n.type !== 'leadSource').length;
  } catch {
    return 0;
  }
}

export function summarizeSchedule(campaign: Campaign | null): string {
  const schedule = scheduleFromCampaign(campaign);
  if (!schedule) return '24/7 (No restrictions)';

  const startMin = schedule.start_hour * 60 + (schedule.start_minute ?? 0);
  const endMin = schedule.end_hour * 60 + (schedule.end_minute ?? 0);
  const is247 = startMin === 0 && endMin >= 1439 && (schedule.days_of_week?.length ?? 0) === 7;
  if (is247) return '24/7 (No restrictions)';

  const time = `${formatHour12(schedule.start_hour, schedule.start_minute ?? 0)} – ${formatHour12(schedule.end_hour, schedule.end_minute ?? 0)}`;
  const days = schedule.days_of_week;
  let dayStr: string;
  if (days.length === 7) {
    dayStr = 'Every day';
  } else if (days.length === 5 && days.every((d) => [1, 2, 3, 4, 5].includes(d))) {
    dayStr = 'Mon–Fri';
  } else {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayStr = days.map((d) => dayLabels[d]).join(', ');
  }

  const tz = TIMEZONES.find((t) => t.value === schedule.timezone)?.label ?? schedule.timezone;
  return `${dayStr}, ${time} ${tz}`;
}

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
