import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns/campaign-stats';

/** Matches Postgres `date_trunc('week', ...)` (Monday UTC). */
export function isoWeekStartUtc(dateYmd: string): string {
  const d = new Date(`${dateYmd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateYmd;
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export type WeeklyOutcomeRow = {
  weekStart: string;
  sent: number;
  replied: number;
  positiveReply: number;
  bounce: number;
};

export function rollupDailyToIsoWeeks(days: CampaignStatsByDay[]): WeeklyOutcomeRow[] {
  const byWeek = new Map<string, WeeklyOutcomeRow>();
  for (const day of days) {
    const weekStart = isoWeekStartUtc(day.date);
    const existing = byWeek.get(weekStart);
    if (existing) {
      existing.sent += day.sent;
      existing.replied += day.replied;
      existing.positiveReply += day.positiveReply;
      existing.bounce += day.bounce;
    } else {
      byWeek.set(weekStart, {
        weekStart,
        sent: day.sent,
        replied: day.replied,
        positiveReply: day.positiveReply,
        bounce: day.bounce,
      });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function formatWeekLabel(weekStartYmd: string): string {
  const d = new Date(`${weekStartYmd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return weekStartYmd;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
