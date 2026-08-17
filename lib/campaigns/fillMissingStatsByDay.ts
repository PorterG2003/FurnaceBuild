import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns/campaign-stats';

/**
 * Expands sparse per-day stats into one row per calendar day (UTC) between
 * startDate and endDate inclusive, filling missing days with zeros.
 * Used for campaign details and account outreach charts.
 */
export function fillMissingStatsByDay(
  rows: CampaignStatsByDay[],
  startDate: string,
  endDate: string,
): CampaignStatsByDay[] {
  const existingByDay = new Map(rows.map((item) => [item.date, item] as const));
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return rows;
  }

  const filled: CampaignStatsByDay[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const existing = existingByDay.get(date);
    filled.push(
      existing ?? {
        date,
        sent: 0,
        replied: 0,
        positiveReply: 0,
        bounce: 0,
        leadsFirstContacted: 0,
      },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return filled;
}
