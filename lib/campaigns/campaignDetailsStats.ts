import type { CampaignStatsByDay } from '@/lib/supabase/services/campaigns/campaign-stats';

export type CampaignDailySeriesPoint = Pick<
  CampaignStatsByDay,
  'sent' | 'replied' | 'positiveReply' | 'bounce' | 'leadsFirstContacted'
>;

/** True when lifetime sends exist but the daily cache series has no activity. */
export function isCampaignDailyStatsCacheMiss(params: {
  series: CampaignDailySeriesPoint[];
  lifetimeSentCount: number;
}): boolean {
  if (params.lifetimeSentCount <= 0) return false;
  if (params.series.length === 0) return true;
  return params.series.every(
    (day) =>
      day.sent === 0 &&
      day.replied === 0 &&
      day.positiveReply === 0 &&
      day.bounce === 0 &&
      (day.leadsFirstContacted ?? 0) === 0,
  );
}

export function campaignChartBootstrapEnd(
  lastActivityDate: string,
  todayUtc: string = new Date().toISOString().slice(0, 10),
): string {
  const d = new Date(`${lastActivityDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  const lastPlus2 = d.toISOString().slice(0, 10);
  return todayUtc <= lastPlus2 ? todayUtc : lastPlus2;
}
