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

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  return (
    message.includes('account_daily_outreach_volume') &&
    (error?.code === 'PGRST202' || error?.code === 'PGRST203' || message.includes('does not exist'))
  );
}

test('account_daily_outreach_volume counts first contact against full history', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('daily-vol'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Daily Volume',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'early',
          email: `early-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'early-job', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
        buildCampaignLead({
          key: 'late',
          email: `late-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'late-job', status: 'sent', nodeFlowNodeId: 'email-1' })],
        }),
      ],
    });

    const early = graph.leadsByKey.get('early')!;
    const late = graph.leadsByKey.get('late')!;

    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: early.leadId,
      enrollmentId: early.enrollmentId!,
      messageJobId: early.messageJobIdsByKey.get('early-job')!,
      sentAt: '2026-07-15T12:00:00.000Z',
    });
    await seedThreadSentAndRepliedEvents(harness.supabase, {
      campaignId: graph.campaignId,
      leadId: late.leadId,
      enrollmentId: late.enrollmentId!,
      messageJobId: late.messageJobIdsByKey.get('late-job')!,
      sentAt: '2026-08-12T12:00:00.000Z',
    });

    const { data, error } = await harness.supabase.rpc('account_daily_outreach_volume', {
      p_account_id: harness.env.accountId,
      p_start_date: '2026-08-10',
      p_end_date: '2026-08-12',
      p_campaign_ids: [graph.campaignId],
    });
    if (isMissingRpc(error)) {
      t.skip(
        'DB-backed test target has not applied account_daily_outreach_volume; refresh PostgREST schema after migrate',
      );
      return;
    }
    assert.equal(error, null, error?.message);
    const rows = (data ?? []) as Array<{
      stat_date: string;
      emails_sent: number | string;
      leads_first_contacted: number | string;
    }>;
    assert.equal(rows.length, 3);
    const byDate = new Map(
      rows.map((row) => [
        String(row.stat_date).slice(0, 10),
        {
          emailsSent: Number(row.emails_sent),
          leadsFirstContacted: Number(row.leads_first_contacted),
        },
      ]),
    );
    assert.deepEqual(byDate.get('2026-08-10'), { emailsSent: 0, leadsFirstContacted: 0 });
    assert.deepEqual(byDate.get('2026-08-11'), { emailsSent: 0, leadsFirstContacted: 0 });
    assert.deepEqual(byDate.get('2026-08-12'), { emailsSent: 1, leadsFirstContacted: 1 });
  } finally {
    await harness.cleanup();
  }
});
