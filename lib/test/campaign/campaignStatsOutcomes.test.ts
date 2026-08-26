/**
 * Campaign stats parity outcomes.
 *
 * Locks M1–M10 from the campaign-stats-parity plan:
 * - outbound vs paced message-type predicates (SQL + TS)
 * - variant stats: priority sent/bounce; replied/positive stay on paced upstream
 * - reconcile includes priority sent without clobbering other totals
 * - has_been_contacted backfill closes historical gaps; inbox excluded
 *
 * Non-goals: inbound OOO replied semantics; dial formula redesign;
 * full priority delivery E2E (see priorityEmailOutcomes.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCampaignMessageJob,
  isPacedCampaignMessageJob,
  isPriorityCampaignJob,
  type MessageType,
} from '../../../workers/send-worker/src/types.js';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  createCampaignTestNamespace,
} from './fixtures';

const PACED_VARIANT_ID = 'f0000000-0000-4000-8000-00000000ea11';
const PRIORITY_VARIANT_ID = 'f0000000-0000-4000-8000-00000000ec31';

type VariantStatRow = {
  node_id: string;
  variant_id: string;
  sent_count: number | string;
  replied_count: number | string;
  positive_reply_count: number | string;
  bounce_count: number | string;
};

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

async function variantStats(
  harness: CampaignDbHarness,
  campaignId: string,
): Promise<VariantStatRow[]> {
  const { data, error } = await harness.supabase.rpc('get_campaign_variant_stats', {
    p_campaign_id: campaignId,
  });
  assert.equal(error, null, error?.message);
  return (data ?? []) as VariantStatRow[];
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
    p_event_data: { source: 'campaign-stats-outcomes' },
  });
  assert.equal(error, null, error?.message);
}

async function sqlBool(
  harness: CampaignDbHarness,
  fn: 'is_campaign_outbound_message_type' | 'is_paced_campaign_message_type',
  t: MessageType | null,
): Promise<boolean> {
  const { data, error } = await harness.supabase.rpc(fn, { t });
  assert.equal(error, null, `${fn}(${String(t)}): ${error?.message}`);
  return Boolean(data);
}

test('M1: TS and SQL message-type predicates agree for every type', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-predicate'),
  });

  try {
    // Touch harness DB connection / env.
    assert.ok(harness.env.accountId);

    const types: Array<MessageType | null> = [
      null,
      'campaign',
      'campaign_priority',
      'campaign_reply',
      'inbox_reply',
      'inbox_forward',
    ];

    for (const t of types) {
      const job = { message_type: t };
      const sqlOutbound = await sqlBool(harness, 'is_campaign_outbound_message_type', t);
      const sqlPaced = await sqlBool(harness, 'is_paced_campaign_message_type', t);
      assert.equal(sqlOutbound, isCampaignMessageJob(job), `outbound ${String(t)}`);
      assert.equal(sqlPaced, isPacedCampaignMessageJob(job), `paced ${String(t)}`);
      assert.equal(
        isPriorityCampaignJob(job),
        t === 'campaign_priority' || t === 'campaign_reply',
        `priority ${String(t)}`,
      );
    }
  } finally {
    await harness.cleanup();
  }
});

test('M2/M3/M4/M10: priority sent+bounce visible; replied/positive stay on paced upstream', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-priority-variant'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Priority Variant Stats',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `stats-pri-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-3',
          }),
          jobs: [
            buildCampaignJob({
              key: 'paced',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              messageType: 'campaign',
              variantId: PACED_VARIANT_ID,
              providerMessageId: `<paced-${harness.namespace}@furnace.test>`,
            }),
            buildCampaignJob({
              key: 'priority',
              nodeFlowNodeId: 'email-3',
              status: 'sent',
              messageType: 'campaign_priority',
              variantId: PRIORITY_VARIANT_ID,
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    const pacedJobId = lead.messageJobIdsByKey.get('paced')!;
    const priorityJobId = lead.messageJobIdsByKey.get('priority')!;
    const pacedNodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const priorityNodeId = graph.nodeIdsByFlowNodeId.get('email-3')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: pacedJobId,
    });
    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: priorityJobId,
    });

    const { error: repliedErr } = await harness.supabase.rpc('record_replied_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: pacedJobId,
      p_is_positive: true,
      p_event_data: { source: 'campaign-stats-outcomes' },
    });
    assert.equal(repliedErr, null, repliedErr?.message);

    const { error: bounceErr } = await harness.supabase.rpc('record_bounced_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: priorityJobId,
      p_mailbox_id: mailboxId,
      p_event_data: {
        source: 'campaign-stats-outcomes',
        bounce_message_id: `<bounce-${harness.namespace}@furnace.test>`,
      },
    });
    assert.equal(bounceErr, null, bounceErr?.message);

    const rows = await variantStats(harness, graph.campaignId);
    const paced = rows.find(
      (r) => r.node_id === pacedNodeId && r.variant_id === PACED_VARIANT_ID,
    );
    const priority = rows.find(
      (r) => r.node_id === priorityNodeId && r.variant_id === PRIORITY_VARIANT_ID,
    );

    assert.ok(paced, 'paced node must appear in variant stats');
    assert.ok(priority, 'priority node must appear in variant stats (M2)');
    assert.equal(n(priority!.sent_count), 1, 'M2 priority sent');
    assert.equal(n(priority!.replied_count), 0, 'M3 priority replied');
    assert.equal(n(priority!.positive_reply_count), 0, 'M3 priority positive');
    assert.equal(n(priority!.bounce_count), 1, 'M10 priority bounce');

    assert.equal(n(paced!.sent_count), 1);
    assert.equal(n(paced!.replied_count), 1, 'M4 upstream replied');
    assert.equal(n(paced!.positive_reply_count), 1, 'M4 upstream positive');

    const { error: clearPositiveErr } = await harness.supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: graph.campaignId,
      p_message_job_id: pacedJobId,
      p_is_positive: false,
    });
    assert.equal(clearPositiveErr, null, clearPositiveErr?.message);
    const afterClear = await variantStats(harness, graph.campaignId);
    const pacedAfterClear = afterClear.find(
      (r) => r.node_id === pacedNodeId && r.variant_id === PACED_VARIANT_ID,
    );
    assert.equal(n(pacedAfterClear?.positive_reply_count), 0);

    const { error: restorePositiveErr } = await harness.supabase.rpc('update_replied_event_is_positive', {
      p_campaign_id: graph.campaignId,
      p_message_job_id: pacedJobId,
      p_is_positive: true,
    });
    assert.equal(restorePositiveErr, null, restorePositiveErr?.message);

    const beforeRebuild = await variantStats(harness, graph.campaignId);
    const { error: rebuildErr } = await harness.supabase.rpc('rebuild_campaign_variant_stats', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(rebuildErr, null, rebuildErr?.message);
    const afterRebuild = await variantStats(harness, graph.campaignId);
    assert.deepEqual(
      afterRebuild
        .map((r) => ({
          node_id: r.node_id,
          variant_id: r.variant_id,
          sent_count: n(r.sent_count),
          replied_count: n(r.replied_count),
          positive_reply_count: n(r.positive_reply_count),
          bounce_count: n(r.bounce_count),
        }))
        .sort((a, b) => `${a.node_id}:${a.variant_id}`.localeCompare(`${b.node_id}:${b.variant_id}`)),
      beforeRebuild
        .map((r) => ({
          node_id: r.node_id,
          variant_id: r.variant_id,
          sent_count: n(r.sent_count),
          replied_count: n(r.replied_count),
          positive_reply_count: n(r.positive_reply_count),
          bounce_count: n(r.bounce_count),
        }))
        .sort((a, b) => `${a.node_id}:${a.variant_id}`.localeCompare(`${b.node_id}:${b.variant_id}`)),
    );
  } finally {
    await harness.cleanup();
  }
});

test('M5: reconcile preserves sent/replied/positive/bounce including priority sent', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-reconcile'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Reconcile Priority',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `stats-rec-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'paced',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              variantId: PACED_VARIANT_ID,
            }),
            buildCampaignJob({
              key: 'priority',
              nodeFlowNodeId: 'email-3',
              status: 'sent',
              messageType: 'campaign_priority',
              variantId: PRIORITY_VARIANT_ID,
            }),
          ],
          // Reconcile reads replied/positive from email_threads, not events.
          thread: buildCampaignThread({
            messageJobKey: 'paced',
            hasReply: true,
            category: 'Interested',
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    const pacedJobId = lead.messageJobIdsByKey.get('paced')!;
    const priorityJobId = lead.messageJobIdsByKey.get('priority')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: pacedJobId,
    });
    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: priorityJobId,
    });

    await harness.supabase.rpc('record_replied_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: pacedJobId,
      p_is_positive: true,
    });
    await harness.supabase.rpc('record_bounced_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: priorityJobId,
      p_mailbox_id: mailboxId,
      p_event_data: {
        bounce_message_id: `<bounce-rec-${harness.namespace}@furnace.test>`,
      },
    });

    const { data: before, error: beforeErr } = await harness.supabase
      .from('campaign_stats')
      .select('sent_count, replied_count, positive_reply_count, bounce_count')
      .eq('campaign_id', graph.campaignId)
      .single();
    assert.equal(beforeErr, null);
    assert.equal(before?.sent_count, 2);
    assert.equal(before?.replied_count, 1);
    assert.equal(before?.positive_reply_count, 1);
    assert.equal(before?.bounce_count, 1);

    const { error: recErr } = await harness.supabase.rpc('reconcile_campaign_stats', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(recErr, null, recErr?.message);

    const { data: after, error: afterErr } = await harness.supabase
      .from('campaign_stats')
      .select('sent_count, replied_count, positive_reply_count, bounce_count')
      .eq('campaign_id', graph.campaignId)
      .single();
    assert.equal(afterErr, null);
    assert.deepEqual(
      {
        sent_count: after?.sent_count,
        replied_count: after?.replied_count,
        positive_reply_count: after?.positive_reply_count,
        bounce_count: after?.bounce_count,
      },
      {
        sent_count: before?.sent_count,
        replied_count: before?.replied_count,
        positive_reply_count: before?.positive_reply_count,
        bounce_count: before?.bounce_count,
      },
    );
  } finally {
    await harness.cleanup();
  }
});

test('M6/M7: contacted backfill closes gap for campaign+priority; inbox excluded', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-contacted-bf'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Contacted Backfill Stats',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'paced-sent',
          email: `bf-paced-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'sent',
              status: 'sent',
              messageType: 'campaign',
              variantId: PACED_VARIANT_ID,
            }),
          ],
        }),
        buildCampaignLead({
          key: 'priority-sent',
          email: `bf-pri-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'sent',
              nodeFlowNodeId: 'email-3',
              status: 'sent',
              messageType: 'campaign_priority',
              variantId: PRIORITY_VARIANT_ID,
            }),
          ],
        }),
        buildCampaignLead({
          key: 'inbox-only',
          email: `bf-inbox-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'inbox',
              status: 'sent',
              messageType: 'inbox_reply',
            }),
          ],
        }),
      ],
    });

    const paced = graph.leadsByKey.get('paced-sent')!;
    const priority = graph.leadsByKey.get('priority-sent')!;
    const inbox = graph.leadsByKey.get('inbox-only')!;

    const { data: before } = await harness.supabase
      .from('enrollments')
      .select('id, has_been_contacted')
      .in('id', [paced.enrollmentId!, priority.enrollmentId!, inbox.enrollmentId!]);
    assert.equal((before ?? []).every((r) => r.has_been_contacted === false), true);

    const { data: updated, error } = await harness.supabase.rpc(
      'backfill_enrollment_has_been_contacted_batch',
      { p_limit: 500, p_campaign_id: graph.campaignId },
    );
    assert.equal(error, null, error?.message);
    assert.equal(updated, 2, 'paced + priority backfilled; inbox excluded');

    const { data: after } = await harness.supabase
      .from('enrollments')
      .select('id, has_been_contacted')
      .in('id', [paced.enrollmentId!, priority.enrollmentId!, inbox.enrollmentId!]);
    const byId = new Map((after ?? []).map((r) => [r.id, r.has_been_contacted]));
    assert.equal(byId.get(paced.enrollmentId!), true);
    assert.equal(byId.get(priority.enrollmentId!), true);
    assert.equal(byId.get(inbox.enrollmentId!), false);

    const { data: updated2, error: err2 } = await harness.supabase.rpc(
      'backfill_enrollment_has_been_contacted_batch',
      { p_limit: 500, p_campaign_id: graph.campaignId },
    );
    assert.equal(err2, null);
    assert.equal(updated2, 0, 'idempotent');
  } finally {
    await harness.cleanup();
  }
});

test('M7/M9: paced-only variant stats still work; inbox never in variant sent', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-paced-only'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Paced Only Stats',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `stats-paced-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'sent',
              status: 'sent',
              variantId: PACED_VARIANT_ID,
            }),
            buildCampaignJob({
              key: 'inbox',
              status: 'sent',
              messageType: 'inbox_reply',
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    const pacedJobId = lead.messageJobIdsByKey.get('sent')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;

    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: pacedJobId,
    });

    await harness.supabase.rpc('record_replied_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: pacedJobId,
      p_is_positive: false,
    });

    const rows = await variantStats(harness, graph.campaignId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.node_id, nodeId);
    assert.equal(rows[0]!.variant_id, PACED_VARIANT_ID);
    assert.equal(n(rows[0]!.sent_count), 1);
    assert.equal(n(rows[0]!.replied_count), 1);
    assert.equal(n(rows[0]!.positive_reply_count), 0);

    const { data: stats } = await harness.supabase
      .from('campaign_stats')
      .select('sent_count')
      .eq('campaign_id', graph.campaignId)
      .single();
    assert.equal(stats?.sent_count, 1, 'inbox_reply did not increment sent');
  } finally {
    await harness.cleanup();
  }
});

test('legacy campaign_reply counts as outbound sent like campaign_priority', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('stats-legacy-reply'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Legacy Reply Stats',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `stats-legacy-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'legacy',
              nodeFlowNodeId: 'email-3',
              status: 'sent',
              messageType: 'campaign_reply',
              variantId: PRIORITY_VARIANT_ID,
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    await markSent(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: lead.messageJobIdsByKey.get('legacy')!,
    });

    const rows = await variantStats(harness, graph.campaignId);
    const priorityNodeId = graph.nodeIdsByFlowNodeId.get('email-3')!;
    const row = rows.find(
      (r) => r.node_id === priorityNodeId && r.variant_id === PRIORITY_VARIANT_ID,
    );
    assert.ok(row);
    assert.equal(n(row!.sent_count), 1);
    assert.equal(n(row!.replied_count), 0);
  } finally {
    await harness.cleanup();
  }
});
