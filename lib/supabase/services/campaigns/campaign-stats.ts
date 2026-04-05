import { supabase } from '../../client';

export interface CampaignStats {
  sentCount: number;
  repliedCount: number;
  positiveReplyCount: number;
  bounceCount: number;
  lastBounceAt: string | null;
  enrollmentCount: number;
  terminalEnrollmentCount: number;
  contactedEnrollmentCount: number;
}

export async function getCampaignStatsForCampaigns(
  campaignIds: string[]
): Promise<Record<string, CampaignStats>> {
  const result: Record<string, CampaignStats> = {};
  if (campaignIds.length === 0) return result;

  for (const id of campaignIds) {
    result[id] = {
      sentCount: 0,
      repliedCount: 0,
      positiveReplyCount: 0,
      bounceCount: 0,
      lastBounceAt: null,
      enrollmentCount: 0,
      terminalEnrollmentCount: 0,
      contactedEnrollmentCount: 0,
    };
  }

  const TERMINAL_STATES = ['stopped', 'completed'];

  const { data: enrollmentRows } = await supabase
    .from('enrollments')
    .select('campaign_id, state')
    .is('deleted_at', null)
    .in('campaign_id', campaignIds);

  if (enrollmentRows) {
    for (const row of enrollmentRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].enrollmentCount++;
        if (TERMINAL_STATES.includes(row.state)) {
          result[row.campaign_id].terminalEnrollmentCount++;
        }
      }
    }
  }

  const { data: contactedRows } = await supabase.rpc('get_campaign_contacted_counts', {
    p_campaign_ids: campaignIds,
  });

  if (contactedRows) {
    for (const row of contactedRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].contactedEnrollmentCount = row.contacted_count ?? 0;
      }
    }
  }

  const { data: statsRows } = await supabase
    .from('campaign_stats')
    .select('campaign_id, sent_count, replied_count, positive_reply_count, bounce_count, last_bounce_at')
    .in('campaign_id', campaignIds);

  if (statsRows) {
    for (const row of statsRows) {
      if (row.campaign_id && result[row.campaign_id]) {
        result[row.campaign_id].sentCount = row.sent_count ?? 0;
        result[row.campaign_id].repliedCount = row.replied_count ?? 0;
        result[row.campaign_id].positiveReplyCount = row.positive_reply_count ?? 0;
        result[row.campaign_id].bounceCount = row.bounce_count ?? 0;
        result[row.campaign_id].lastBounceAt = row.last_bounce_at ?? null;
      }
    }
  }

  return result;
}

export interface CampaignStatsByDay {
  date: string;
  sent: number;
  replied: number;
  positiveReply: number;
  bounce: number;
}

export async function getCampaignStatsByDay(
  campaignId: string,
  startDate: string,
  endDate: string,
  source?: string | null
): Promise<CampaignStatsByDay[]> {
  if (source === 'smartlead') {
    const { data: rows, error } = await supabase
      .from('imported_campaign_stats_by_day')
      .select('date, sent_count, replied_count, positive_reply_count, bounce_count')
      .eq('campaign_id', campaignId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) throw new Error(`Failed to fetch imported campaign stats by day: ${error.message}`);
    return (rows || []).map((r: any) => ({
      date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
      sent: r.sent_count ?? 0,
      replied: r.replied_count ?? 0,
      positiveReply: r.positive_reply_count ?? 0,
      bounce: r.bounce_count ?? 0,
    }));
  }

  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T23:59:59.999Z');

  const { data: rows, error } = await supabase
    .from('events')
    .select('event_type, event_data, created_at')
    .eq('campaign_id', campaignId)
    .in('event_type', ['sent', 'replied', 'bounced'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  if (error) throw new Error(`Failed to fetch campaign stats by day: ${error.message}`);

  const byDay = new Map<string, { sent: number; replied: number; positiveReply: number; bounce: number }>();
  const addDay = (d: string) => {
    if (!byDay.has(d)) byDay.set(d, { sent: 0, replied: 0, positiveReply: 0, bounce: 0 });
    return byDay.get(d)!;
  };

  for (const row of rows || []) {
    const day = row.created_at?.slice(0, 10) ?? '';
    if (!day) continue;
    const bucket = addDay(day);
    if (row.event_type === 'sent') bucket.sent += 1;
    else if (row.event_type === 'replied') {
      bucket.replied += 1;
      const isPositive = row.event_data && (row.event_data as any).is_positive === true;
      if (isPositive) bucket.positiveReply += 1;
    } else if (row.event_type === 'bounced') bucket.bounce += 1;
  }

  const sorted = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([date, counts]) => ({ date, ...counts }));
}

/**
 * Recompute campaign_stats from message_jobs, email_threads, and events.
 * Pass null to reconcile all campaigns. Returns number of rows updated.
 */
export async function reconcileCampaignStats(campaignId: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('reconcile_campaign_stats', {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
