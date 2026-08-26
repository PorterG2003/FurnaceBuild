/**
 * campaign_stats_daily cache parity with events.
 *
 * Locks writer increments, UTC bucketing, backdated seed rebuild,
 * reconcile repair, and the health report (0 mismatched days).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { seedThreadSentAndRepliedEvents } from './seedCampaignStats';

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

function ymd(value: string): string {
  return String(value).slice(0, 10);
}

type DailyRow = {
  campaign_id: string;
  stat_date: string;
  sent_count: number | string;
  replied_count: number | string;
  positive_reply_count: number | string;
  bounce_count: number | string;
  leads_first_contacted: number | string;
};

type HealthReport = {
  daysMismatched: number | string;
  sentDelta?: number | string;
  sample?: unknown[];
};

async function dailyRows(
  harness: CampaignDbHarness,
  campaignId: string,
): Promise<DailyRow[]> {
  const { data, error } = await harness.supabase
    .from('campaign_stats_daily')
    .select(
      'campaign_id, stat_date, sent_count, replied_count, positive_reply_count, bounce_count, leads_first_contacted',
    )
    .eq('campaign_id', campaignId);
  assert.equal(error, null, error?.message);
  return (data ?? []) as DailyRow[];
}

async function health(
  harness: CampaignDbHarness,
  campaignId: string,
): Promise<HealthReport> {
  const { data, error } = await harness.supabase.rpc('campaign_stats_daily_health_report', {
    p_account_id: harness.env.accountId,
    p_campaign_id: campaignId,
  });
  assert.equal(error, null, error?.message);
  return (data ?? {}) as HealthReport;
}

async function markSent(
  harness: CampaignDbHarness,
  params: {
    campaignId: string;
    leadId: string;
    enrollmentId: string;
    messageJobId: string;
  },
) {
  const { error } = await harness.supabase.rpc('record_sent_event_and_increment', {
    p_campaign_id: params.campaignId,
    p_lead_id: params.leadId,
    p_enrollment_id: params.enrollmentId,
    p_message_job_id: params.messageJobId,
    p_event_data: { source: 'campaign-stats-daily-outcomes' },
  });
  assert.equal(error, null, error?.message);
}

test('daily rows increment on send/reply/bounce; second send is not first contact', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-inc'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Increment',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `daily-inc-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({ key: 'first', status: 'sent', nodeFlowNodeId: 'email-1' }),
            buildCampaignJob({ key: 'second', status: 'sent', nodeFlowNodeId: 'email-1' }),
          ],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead-a')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const today = new Date().toISOString().slice(0, 10);

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('first')!,
    });

    let rows = await dailyRows(harness, graph.campaignId);
    let todayRow = rows.find((r) => ymd(r.stat_date) === today);
    assert.ok(todayRow, 'expected a daily row for today after first send');
    assert.equal(n(todayRow!.sent_count), 1);
    assert.equal(n(todayRow!.leads_first_contacted), 1);

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('second')!,
    });

    const { error: repliedErr } = await harness.supabase.rpc('record_replied_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: lead.messageJobIdsByKey.get('first')!,
      p_is_positive: true,
      p_event_data: { source: 'campaign-stats-daily-outcomes' },
    });
    assert.equal(repliedErr, null, repliedErr?.message);

    const { error: bounceErr } = await harness.supabase.rpc('record_bounced_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: lead.messageJobIdsByKey.get('second')!,
      p_mailbox_id: mailboxId,
      p_event_data: {
        source: 'campaign-stats-daily-outcomes',
        bounce_message_id: `<daily-bounce-${harness.namespace}@furnace.test>`,
      },
    });
    assert.equal(bounceErr, null, bounceErr?.message);

    const { data: bouncedAgain, error: bounce2Err } = await harness.supabase.rpc(
      'record_bounced_event_and_increment',
      {
        p_campaign_id: graph.campaignId,
        p_lead_id: lead.leadId,
        p_enrollment_id: lead.enrollmentId!,
        p_message_job_id: lead.messageJobIdsByKey.get('second')!,
        p_mailbox_id: mailboxId,
        p_event_data: {
          source: 'campaign-stats-daily-outcomes',
          bounce_message_id: `<daily-bounce-${harness.namespace}@furnace.test>`,
        },
      },
    );
    assert.equal(bounce2Err, null, bounce2Err?.message);
    assert.equal(bouncedAgain, false, 'idempotent bounce must not insert again');

    rows = await dailyRows(harness, graph.campaignId);
    todayRow = rows.find((r) => ymd(r.stat_date) === today);
    assert.ok(todayRow);
    assert.equal(n(todayRow!.sent_count), 2);
    assert.equal(n(todayRow!.leads_first_contacted), 1);
    assert.equal(n(todayRow!.replied_count), 1);
    assert.equal(n(todayRow!.positive_reply_count), 1);
    assert.equal(n(todayRow!.bounce_count), 1);

    const report = await health(harness, graph.campaignId);
    assert.equal(n(report.daysMismatched), 0, JSON.stringify(report.sample));
  } finally {
    await harness.cleanup();
  }
});

test('positive-reply toggle lands on the replied event UTC day, not today', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-pos'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Positive Date',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `daily-pos-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead-a')!;

    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-07-15T12:00:00.000Z',
      replyAt: '2026-07-16T08:00:00.000Z',
      isPositive: false,
    });

    const { error: onErr } = await harness.supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: graph.campaignId,
      p_message_job_id: lead.messageJobIdsByKey.get('sent')!,
      p_is_positive: true,
    });
    assert.equal(onErr, null, onErr?.message);

    const rows = await dailyRows(harness, graph.campaignId);
    const july16 = rows.find((r) => ymd(r.stat_date) === '2026-07-16');
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = rows.find((r) => ymd(r.stat_date) === today);
    assert.equal(n(july16?.positive_reply_count), 1);
    if (today !== '2026-07-16') {
      assert.equal(n(todayRow?.positive_reply_count), 0);
    }

    const { error: offErr } = await harness.supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: graph.campaignId,
      p_message_job_id: lead.messageJobIdsByKey.get('sent')!,
      p_is_positive: false,
    });
    assert.equal(offErr, null, offErr?.message);

    const after = await dailyRows(harness, graph.campaignId);
    const july16After = after.find((r) => ymd(r.stat_date) === '2026-07-16');
    assert.equal(n(july16After?.positive_reply_count), 0);

    const report = await health(harness, graph.campaignId);
    assert.equal(n(report.daysMismatched), 0, JSON.stringify(report.sample));
  } finally {
    await harness.cleanup();
  }
});

test('UTC midnight boundary buckets sent events onto different stat_dates', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-utc'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily UTC Boundary',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'before',
          email: `daily-utc-b-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'after',
          email: `daily-utc-a-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const before = graph.leadsByKey.get('before')!;
    const after = graph.leadsByKey.get('after')!;

    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: before.leadId,
      enrollmentId: before.enrollmentId!,
      messageJobId: before.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-08-11T23:30:00.000Z',
    });
    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: after.leadId,
      enrollmentId: after.enrollmentId!,
      messageJobId: after.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-08-12T00:30:00.000Z',
    });

    const rows = await dailyRows(harness, graph.campaignId);
    const byDate = new Map(rows.map((r) => [ymd(r.stat_date), n(r.sent_count)]));
    assert.equal(byDate.get('2026-08-11'), 1);
    assert.equal(byDate.get('2026-08-12'), 1);

    const report = await health(harness, graph.campaignId);
    assert.equal(n(report.daysMismatched), 0, JSON.stringify(report.sample));
  } finally {
    await harness.cleanup();
  }
});

test('backdated seed rebuilds daily onto the event UTC day', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-backdate'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Backdate',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `daily-bd-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead-a')!;

    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-07-15T12:00:00.000Z',
    });

    const rows = await dailyRows(harness, graph.campaignId);
    const july = rows.find((r) => ymd(r.stat_date) === '2026-07-15');
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = rows.find((r) => ymd(r.stat_date) === today);
    assert.equal(n(july?.sent_count), 1);
    assert.equal(n(july?.leads_first_contacted), 1);
    if (today !== '2026-07-15') {
      assert.equal(n(todayRow?.sent_count), 0);
    }

    const report = await health(harness, graph.campaignId);
    assert.equal(n(report.daysMismatched), 0, JSON.stringify(report.sample));
  } finally {
    await harness.cleanup();
  }
});

test('reconcile repairs a drifted daily row from events', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-reconcile'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Reconcile',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `daily-rec-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead-a')!;
    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-07-15T12:00:00.000Z',
    });

    const { error: driftErr } = await harness.supabase
      .from('campaign_stats_daily')
      .update({ sent_count: 999 } as any)
      .eq('campaign_id', graph.campaignId)
      .eq('stat_date', '2026-07-15');
    assert.equal(driftErr, null, driftErr?.message);

    const drifted = await health(harness, graph.campaignId);
    assert.ok(n(drifted.daysMismatched) > 0, 'forced drift must show up in the health report');

    const { error: recErr } = await harness.supabase.rpc('reconcile_campaign_stats', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(recErr, null, recErr?.message);

    const rows = await dailyRows(harness, graph.campaignId);
    const july = rows.find((r) => ymd(r.stat_date) === '2026-07-15');
    assert.equal(n(july?.sent_count), 1);

    const report = await health(harness, graph.campaignId);
    assert.equal(n(report.daysMismatched), 0, JSON.stringify(report.sample));
  } finally {
    await harness.cleanup();
  }
});

test('campaign_stats_daily_activity_range is null without activity and spans send days after increment', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-range'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Activity Range',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `daily-range-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const lead = graph.leadsByKey.get('lead-a')!;

    const { data: emptyRange, error: emptyErr } = await harness.supabase.rpc(
      'campaign_stats_daily_activity_range',
      { p_campaign_id: graph.campaignId },
    );
    assert.equal(emptyErr, null, emptyErr?.message);
    const emptyRow = (emptyRange ?? [])[0] as { start_date?: string | null; end_date?: string | null } | undefined;
    assert.equal(emptyRow?.start_date ?? null, null);
    assert.equal(emptyRow?.end_date ?? null, null);

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('sent')!,
    });

    const today = new Date().toISOString().slice(0, 10);
    const { data: activeRange, error: activeErr } = await harness.supabase.rpc(
      'campaign_stats_daily_activity_range',
      { p_campaign_id: graph.campaignId },
    );
    assert.equal(activeErr, null, activeErr?.message);
    const activeRow = (activeRange ?? [])[0] as { start_date?: string | null; end_date?: string | null };
    assert.equal(ymd(String(activeRow.start_date)), today);
    assert.equal(ymd(String(activeRow.end_date)), today);
  } finally {
    await harness.cleanup();
  }
});
