import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns/campaign-stats';
import { isoWeekStartUtc, rollupDailyToIsoWeeks } from './weeklyRollup';

const TRAILING_WEEKS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Queue runway in weeks: leads still waiting for a first send, divided by
 * trailing 4-week send pace (emails/week) from the daily series.
 * Returns null when pace is zero.
 */
export function queueRunwayWeeks(
  leadsInQueue: number,
  statsByDay: CampaignStatsByDay[],
  trailingWeeks: number = TRAILING_WEEKS,
): number | null {
  if (leadsInQueue < 0) return null;
  const weekly = rollupDailyToIsoWeeks(statsByDay);
  if (weekly.length === 0) return null;
  const recent = weekly.slice(-trailingWeeks);
  const totalSent = recent.reduce((sum, row) => sum + row.sent, 0);
  const pace = totalSent / recent.length;
  if (pace <= 0) return null;
  return Math.round((leadsInQueue / pace) * 10) / 10;
}

export function queueRunwayEndDate(
  leadsInQueue: number,
  statsByDay: CampaignStatsByDay[],
  now: Date = new Date(),
  trailingWeeks: number = TRAILING_WEEKS,
): Date | null {
  const weeks = queueRunwayWeeks(leadsInQueue, statsByDay, trailingWeeks);
  if (weeks == null) return null;
  const days = Math.max(0, Math.round(weeks * 7));
  const end = startOfLocalDay(now);
  end.setDate(end.getDate() + days);
  return end;
}

export function formatRelativeDay(date: Date, now: Date = new Date()): string {
  const target = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const diffDays = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays < 7) {
    return target.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return target.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: target.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatRunwayThrough(
  endDate: Date | null,
  now: Date = new Date(),
): string | null {
  if (endDate == null) return null;
  return `Through ${formatRelativeDay(endDate, now)}`;
}

export function formatRunwayWeeks(weeks: number | null): string {
  if (weeks == null) return '—';
  if (weeks < 0.1) return '<0.1 wks';
  return `${weeks} wks`;
}

export function trailingWeekCount(statsByDay: CampaignStatsByDay[]): number {
  const weeks = new Set(statsByDay.map((d) => isoWeekStartUtc(d.date)));
  return weeks.size;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
