/**
 * Account outreach metrics / by-day RPC parity with events and queue semantics.
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

function isMissingRpc(error: { message?: string; code?: string } | null, name: string): boolean {
  const message = error?.message ?? '';
  return (
    message.includes(name) &&
    (error?.code === 'PGRST202' || error?.code === 'PGRST203' || message.includes('does not exist'))
  );
}

test('outreach metrics and by-day match events; reached is not first-contact', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('acct-metrics'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Account Metrics Parity',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'early',
          email: `acct-early-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({ key: 'early-job', status: 'sent', nodeFlowNodeId: 'email-1' }),
            buildCampaignJob({ key: 'followup', status: 'sent', nodeFlowNodeId: 'email-1' }),
          ],
        }),
        buildCampaignLead({
          key: 'queued',
          email: `acct-queued-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'queued-job', status: 'queued', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const early = graph.leadsByKey.get('early')!;

    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: early.leadId,
      enrollmentId: early.enrollmentId!,
      messageJobId: early.messageJobIdsByKey.get('early-job')!,
      sentAt: '2026-07-15T12:00:00.000Z',
      replyAt: '2026-07-16T12:00:00.000Z',
      isPositive: true,
    });
    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: early.leadId,
      enrollmentId: early.enrollmentId!,
      messageJobId: early.messageJobIdsByKey.get('followup')!,
      sentAt: '2026-08-12T12:00:00.000Z',
    });

    const { data, error } = await harness.supabase.rpc('account_outreach_metrics', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-10',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    if (isMissingRpc(error, 'account_outreach_metrics')) {
      t.skip('account_outreach_metrics signature not applied');
      return;
    }
    assert.equal(error, null, error?.message);
    const row = Array.isArray(data) ? data[0] : data;
    assert.ok(row);
    assert.equal(n((row as { total_sent: number }).total_sent), 1);
    assert.equal(n((row as { total_replied?: number }).total_replied), 0);
    assert.equal(n((row as { total_positive_reply: number }).total_positive_reply), 0);
    assert.equal(n((row as { leads_reached: number }).leads_reached), 1);
    assert.equal(n((row as { leads_in_queue: number }).leads_in_queue), 1);

    const { data: byDay, error: byDayErr } = await harness.supabase.rpc(
      'account_outreach_stats_by_day',
      {
        p_account_id: harness.env.accountId,
        p_start_date: '2026-08-10',
        p_end_date: '2026-08-12',
        p_campaign_ids: [graph.campaignId],
      },
    );
    assert.equal(byDayErr, null, byDayErr?.message);
    const days = (byDay ?? []) as Array<{
      stat_date: string;
      sent_count: number | string;
      leads_first_contacted?: number | string;
    }>;
    const aug12 = days.find((d) => ymd(d.stat_date) === '2026-08-12');
    assert.equal(n(aug12?.sent_count), 1);
    assert.equal(n(aug12?.leads_first_contacted), 0, 'follow-up send is not first contact');

    const { data: volume, error: volErr } = await harness.supabase.rpc(
      'account_daily_outreach_volume',
      {
        p_account_id: harness.env.accountId,
        p_start_date: '2026-08-10',
        p_end_date: '2026-08-12',
        p_campaign_ids: [graph.campaignId],
      },
    );
    assert.equal(volErr, null, volErr?.message);
    const vol12 = ((volume ?? []) as Array<{
      stat_date: string;
      emails_sent: number | string;
      leads_first_contacted: number | string;
    }>).find((d) => ymd(d.stat_date) === '2026-08-12');
    assert.equal(n(vol12?.emails_sent), 1);
    assert.equal(n(vol12?.leads_first_contacted), 0);
  } finally {
    await harness.cleanup();
  }
});

test('queue uses has_been_contacted; stopped campaigns are excluded', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('acct-queue'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Account Queue',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'contacted',
          email: `q-c-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'waiting',
          email: `q-w-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'queued', status: 'queued', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });
    const contacted = graph.leadsByKey.get('contacted')!;
    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: contacted.leadId,
      enrollmentId: contacted.enrollmentId!,
      messageJobId: contacted.messageJobIdsByKey.get('sent')!,
      sentAt: '2026-08-12T12:00:00.000Z',
    });

    const running = await harness.supabase.rpc('account_outreach_metrics', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    assert.equal(running.error, null, running.error?.message);
    const runningRow = Array.isArray(running.data) ? running.data[0] : running.data;
    assert.equal(n((runningRow as { leads_in_queue: number }).leads_in_queue), 1);

    const { error: stopErr } = await harness.supabase
      .from('campaigns')
      .update({ status: 'stopped' } as any)
      .eq('id', graph.campaignId);
    assert.equal(stopErr, null, stopErr?.message);

    const stopped = await harness.supabase.rpc('account_outreach_metrics', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    assert.equal(stopped.error, null, stopped.error?.message);
    const stoppedRow = Array.isArray(stopped.data) ? stopped.data[0] : stopped.data;
    assert.equal(n((stoppedRow as { leads_in_queue: number }).leads_in_queue), 0);
  } finally {
    await harness.cleanup();
  }
});

test('smartlead and soft-deleted campaigns are excluded from account rollups', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('acct-excl'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Account Exclusions',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `acct-ex-${harness.namespace}@furnace.test`,
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
      sentAt: '2026-08-12T12:00:00.000Z',
    });

    const { error: slErr } = await harness.supabase
      .from('campaigns')
      .update({ source: 'smartlead' } as any)
      .eq('id', graph.campaignId);
    assert.equal(slErr, null, slErr?.message);

    const sl = await harness.supabase.rpc('account_outreach_metrics', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    assert.equal(sl.error, null, sl.error?.message);
    const slRow = Array.isArray(sl.data) ? sl.data[0] : sl.data;
    assert.equal(n((slRow as { total_sent: number }).total_sent), 0);
    assert.equal(n((slRow as { leads_reached: number }).leads_reached), 0);

    const { error: srcErr } = await harness.supabase
      .from('campaigns')
      .update({ source: null } as any)
      .eq('id', graph.campaignId);
    assert.equal(srcErr, null, srcErr?.message);

    const { error: delErr } = await harness.supabase
      .from('campaigns')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', graph.campaignId);
    assert.equal(delErr, null, delErr?.message);

    const deleted = await harness.supabase.rpc('account_outreach_metrics', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    assert.equal(deleted.error, null, deleted.error?.message);
    const deletedRow = Array.isArray(deleted.data) ? deleted.data[0] : deleted.data;
    assert.equal(n((deletedRow as { total_sent: number }).total_sent), 0);
    assert.equal(n((deletedRow as { leads_reached: number }).leads_reached), 0);
  } finally {
    await harness.cleanup();
  }
});
