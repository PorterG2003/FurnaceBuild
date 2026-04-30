import { supabase } from '../../client';
import type { CampaignStatsByDay } from './campaign-stats';

type RpcRow = {
  stat_date: string;
  sent_count: number | string | null;
  replied_count: number | string | null;
  positive_reply_count: number | string | null;
  bounce_count: number | string | null;
};

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toYmd(statDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(statDate)) return statDate;
  return new Date(statDate).toISOString().slice(0, 10);
}

export async function getAccountOutreachStatsByDay(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<CampaignStatsByDay[]> {
  const { data, error } = await supabase.rpc('account_outreach_stats_by_day', {
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) {
    throw new Error(`Failed to load account outreach stats by day: ${error.message}`);
  }
  const rows = (data ?? []) as RpcRow[];
  return rows.map((r) => ({
    date: toYmd(r.stat_date),
    sent: num(r.sent_count),
    replied: num(r.replied_count),
    positiveReply: num(r.positive_reply_count),
    bounce: num(r.bounce_count),
  }));
}
