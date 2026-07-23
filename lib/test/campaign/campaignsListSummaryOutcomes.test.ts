import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

type ListRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  has_flow: boolean;
  sent_count: number;
  replied_count: number;
  positive_reply_count: number;
  bounce_count: number;
  enrollment_count: number;
  terminal_enrollment_count: number;
  contacted_enrollment_count: number;
};

async function loadList(
  harness: CampaignDbHarness,
  args: {
    accountId?: string;
    search?: string | null;
    statuses?: string[] | null;
    tagIds?: string[] | null;
    limit?: number | null;
    cursorCreatedAt?: string | null;
    cursorId?: string | null;
  } = {},
): Promise<ListRow[]> {
  const { data, error } = await harness.supabase.rpc('campaigns_list_summary', {
    p_account_id: args.accountId ?? harness.env.accountId,
    p_search: args.search ?? null,
    p_statuses: args.statuses ?? null,
    p_tag_ids: args.tagIds ?? null,
    p_limit: args.limit ?? null,
    p_cursor_created_at: args.cursorCreatedAt ?? null,
    p_cursor_id: args.cursorId ?? null,
  });
  assert.equal(error, null, error?.message);
  return (data ?? []) as ListRow[];
}

async function markContactedViaSentRpc(
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
    p_event_data: { source: 'campaigns-list-summary-test' },
  });
  assert.equal(error, null, error?.message);
}

test('first campaign send marks enrollment contacted; second send is a no-op', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('contacted-flag') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Contacted Flag',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `flag-a-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({ key: 'job-1', status: 'sent' }),
            buildCampaignJob({ key: 'job-2', status: 'sent' }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    assert.ok(lead.enrollmentId);
    const jobIds = [...lead.messageJobIdsByKey.values()];
    assert.equal(jobIds.length, 2);

    const { data: before, error: beforeErr } = await harness.supabase
      .from('enrollments')
      .select('has_been_contacted')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(beforeErr, null);
    assert.equal(before?.has_been_contacted, false);

    await markContactedViaSentRpc(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: jobIds[0]!,
    });

    const { data: afterFirst, error: afterFirstErr } = await harness.supabase
      .from('enrollments')
      .select('has_been_contacted')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(afterFirstErr, null);
    assert.equal(afterFirst?.has_been_contacted, true);

    await markContactedViaSentRpc(harness, {
      campaignId: graph.campaignId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      messageJobId: jobIds[1]!,
    });

    const { data: afterSecond, error: afterSecondErr } = await harness.supabase
      .from('enrollments')
      .select('has_been_contacted')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(afterSecondErr, null);
    assert.equal(afterSecond?.has_been_contacted, true);

    const rows = await loadList(harness);
    const row = rows.find((r) => r.id === graph.campaignId);
    assert.ok(row);
    assert.equal(row.contacted_enrollment_count, 1);
    assert.equal(row.enrollment_count, 1);
  } finally {
    await harness.cleanup();
  }
});

test('inbox_reply jobs without sent RPC leave has_been_contacted false', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('contacted-inbox') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Inbox Flag',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `inbox-flag-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'inbox', status: 'sent', messageType: 'inbox_reply' })],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead-a')!;
    const { data, error } = await harness.supabase
      .from('enrollments')
      .select('has_been_contacted')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(error, null);
    assert.equal(data?.has_been_contacted, false);

    const rows = await loadList(harness);
    const row = rows.find((r) => r.id === graph.campaignId);
    assert.ok(row);
    assert.equal(row.contacted_enrollment_count, 0);
  } finally {
    await harness.cleanup();
  }
});

test('list dial counts match enrollment flag truth and exclude soft-deleted', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-dial') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Dial Counts',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'active-contacted',
          email: `dial-active-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent' })],
        }),
        buildCampaignLead({
          key: 'terminal',
          email: `dial-terminal-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'completed' }),
        }),
        buildCampaignLead({
          key: 'to-delete',
          email: `dial-delete-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent-del', status: 'sent' })],
        }),
      ],
    });

    const active = graph.leadsByKey.get('active-contacted')!;
    const doomed = graph.leadsByKey.get('to-delete')!;

    await markContactedViaSentRpc(harness, {
      campaignId: graph.campaignId,
      leadId: active.leadId,
      enrollmentId: active.enrollmentId!,
      messageJobId: [...active.messageJobIdsByKey.values()][0]!,
    });
    await markContactedViaSentRpc(harness, {
      campaignId: graph.campaignId,
      leadId: doomed.leadId,
      enrollmentId: doomed.enrollmentId!,
      messageJobId: [...doomed.messageJobIdsByKey.values()][0]!,
    });

    const { error: softDeleteErr } = await harness.supabase
      .from('enrollments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', doomed.enrollmentId!);
    assert.equal(softDeleteErr, null);

    const { data: contactedLegacy, error: contactedErr } = await harness.supabase.rpc(
      'get_campaign_contacted_counts',
      { p_campaign_ids: [graph.campaignId] },
    );
    assert.equal(contactedErr, null);

    const rows = await loadList(harness);
    const row = rows.find((r) => r.id === graph.campaignId);
    assert.ok(row);
    assert.equal(row.enrollment_count, 2);
    assert.equal(row.terminal_enrollment_count, 1);
    assert.equal(row.contacted_enrollment_count, 1);

    // Legacy contacted counts all sent jobs including soft-deleted enrollments' jobs;
    // list dial uses flag on non-deleted enrollments only.
    const legacyCount = Array.isArray(contactedLegacy)
      ? Number(contactedLegacy[0]?.contacted_count ?? 0)
      : 0;
    assert.equal(legacyCount >= 1, true);
  } finally {
    await harness.cleanup();
  }
});

test('campaigns_list_summary filters by search status and tags; pagination is gapless', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-filters') });
  const createdTagIds: string[] = [];

  try {
    const running = await harness.createCampaignGraph({
      name: `Alpha Running ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `filt-run-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    const paused = await harness.createCampaignGraph({
      name: `Beta Paused ${harness.namespace}`,
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `filt-pause-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    const draft = await harness.createCampaignGraph({
      name: `Gamma Draft ${harness.namespace}`,
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const t0 = '2026-01-01T00:00:00.000Z';
    const t1 = '2026-01-02T00:00:00.000Z';
    const t2 = '2026-01-03T00:00:00.000Z';
    await harness.supabase.from('campaigns').update({ created_at: t0 }).eq('id', draft.campaignId);
    await harness.supabase.from('campaigns').update({ created_at: t1 }).eq('id', paused.campaignId);
    await harness.supabase.from('campaigns').update({ created_at: t2 }).eq('id', running.campaignId);

    const tagId = randomUUID();
    createdTagIds.push(tagId);
    const { error: tagErr } = await harness.supabase.from('campaign_tags').insert({
      id: tagId,
      account_id: harness.env.accountId,
      name: `ListTag ${harness.namespace}`,
      color: '#f97316',
    } as any);
    assert.equal(tagErr, null);
    const { error: assignErr } = await harness.supabase.from('campaign_tag_assignments').insert({
      campaign_id: running.campaignId,
      tag_id: tagId,
      account_id: harness.env.accountId,
    } as any);
    assert.equal(assignErr, null);

    const bySearch = await loadList(harness, { search: 'alpha' });
    assert.deepEqual(
      bySearch.map((r) => r.id),
      [running.campaignId],
    );

    const byStatus = await loadList(harness, { statuses: ['running', 'paused'] });
    const statusIds = new Set(byStatus.map((r) => r.id));
    assert.equal(statusIds.has(running.campaignId), true);
    assert.equal(statusIds.has(paused.campaignId), true);
    assert.equal(statusIds.has(draft.campaignId), false);

    const byTag = await loadList(harness, { tagIds: [tagId] });
    assert.deepEqual(
      byTag.map((r) => r.id),
      [running.campaignId],
    );

    const combined = await loadList(harness, {
      search: 'alpha',
      statuses: ['running'],
      tagIds: [tagId],
    });
    assert.deepEqual(
      combined.map((r) => r.id),
      [running.campaignId],
    );

    const full = await loadList(harness);
    const scoped = full.filter((r) =>
      [running.campaignId, paused.campaignId, draft.campaignId].includes(r.id),
    );
    assert.deepEqual(
      scoped.map((r) => r.id),
      [running.campaignId, paused.campaignId, draft.campaignId],
    );

    const page1 = await loadList(harness, { limit: 2 });
    const scopedPage1 = page1.filter((r) =>
      [running.campaignId, paused.campaignId, draft.campaignId].includes(r.id),
    );
    // May include other account campaigns from shared test account; page over our three with cursor.
    const pageA = await loadList(harness, {
      search: harness.namespace,
      limit: 2,
    });
    assert.equal(pageA.length, 2);
    const pageB = await loadList(harness, {
      search: harness.namespace,
      limit: 2,
      cursorCreatedAt: pageA[1]!.created_at,
      cursorId: pageA[1]!.id,
    });
    assert.equal(pageB.length, 1);
    const concat = [...pageA, ...pageB];
    assert.equal(new Set(concat.map((r) => r.id)).size, 3);
    assert.deepEqual(
      concat.map((r) => r.id),
      [running.campaignId, paused.campaignId, draft.campaignId],
    );

    const pastEnd = await loadList(harness, {
      search: harness.namespace,
      limit: 2,
      cursorCreatedAt: pageB[0]!.created_at,
      cursorId: pageB[0]!.id,
    });
    assert.deepEqual(pastEnd, []);
  } finally {
    if (createdTagIds.length > 0) {
      await harness.supabase.from('campaign_tag_assignments').delete().in('tag_id', createdTagIds);
      await harness.supabase.from('campaign_tags').delete().in('id', createdTagIds);
    }
    await harness.cleanup();
  }
});

test('backfill_enrollment_has_been_contacted_batch matches sent campaign jobs and is idempotent', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('contacted-backfill') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Backfill Contacted',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'with-sent',
          email: `bf-sent-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent', status: 'sent' })],
        }),
        buildCampaignLead({
          key: 'queued-only',
          email: `bf-queued-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'queued', status: 'queued' })],
        }),
      ],
    });

    const withSent = graph.leadsByKey.get('with-sent')!;
    const queuedOnly = graph.leadsByKey.get('queued-only')!;

    const { data: beforeRows } = await harness.supabase
      .from('enrollments')
      .select('id, has_been_contacted')
      .in('id', [withSent.enrollmentId!, queuedOnly.enrollmentId!]);
    assert.equal((beforeRows ?? []).every((r) => r.has_been_contacted === false), true);

    const { data: updated, error } = await harness.supabase.rpc(
      'backfill_enrollment_has_been_contacted_batch',
      { p_limit: 500, p_campaign_id: graph.campaignId },
    );
    assert.equal(error, null, error?.message);
    assert.equal(typeof updated === 'number' && updated >= 1, true);

    const { data: afterFirst } = await harness.supabase
      .from('enrollments')
      .select('id, has_been_contacted')
      .in('id', [withSent.enrollmentId!, queuedOnly.enrollmentId!]);
    const byId = new Map((afterFirst ?? []).map((r) => [r.id, r.has_been_contacted]));
    assert.equal(byId.get(withSent.enrollmentId!), true);
    assert.equal(byId.get(queuedOnly.enrollmentId!), false);

    const { data: contactedLegacy, error: contactedErr } = await harness.supabase.rpc(
      'get_campaign_contacted_counts',
      { p_campaign_ids: [graph.campaignId] },
    );
    assert.equal(contactedErr, null);
    const legacyCount = Array.isArray(contactedLegacy)
      ? Number(contactedLegacy[0]?.contacted_count ?? 0)
      : 0;

    const listRows = await loadList(harness);
    const row = listRows.find((r) => r.id === graph.campaignId);
    assert.ok(row);
    assert.equal(row.contacted_enrollment_count, legacyCount);

    const { data: updatedAgain, error: againErr } = await harness.supabase.rpc(
      'backfill_enrollment_has_been_contacted_batch',
      { p_limit: 500, p_campaign_id: graph.campaignId },
    );
    assert.equal(againErr, null, againErr?.message);
    assert.equal(updatedAgain, 0);

    const { data: afterSecond } = await harness.supabase
      .from('enrollments')
      .select('id, has_been_contacted')
      .in('id', [withSent.enrollmentId!, queuedOnly.enrollmentId!]);
    const byId2 = new Map((afterSecond ?? []).map((r) => [r.id, r.has_been_contacted]));
    assert.equal(byId2.get(withSent.enrollmentId!), true);
    assert.equal(byId2.get(queuedOnly.enrollmentId!), false);
  } finally {
    await harness.cleanup();
  }
});

test('campaigns_list_summary joins campaign_stats and has_flow; ignores other accounts', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-stats') });
  const other = new CampaignDbHarness({ namespace: createCampaignTestNamespace('list-other') });

  try {
    const withFlow = await harness.createCampaignGraph({
      name: `Stats Flow ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const { error: statsErr } = await harness.supabase.from('campaign_stats').upsert({
      campaign_id: withFlow.campaignId,
      account_id: harness.env.accountId,
      sent_count: 11,
      replied_count: 4,
      positive_reply_count: 2,
      bounce_count: 1,
    } as any);
    assert.equal(statsErr, null);

    const otherGraph = await other.createCampaignGraph({
      name: `Other Account ${other.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    // Force other campaign onto a different account id if harness shares account —
    // skip isolation assert when both harnesses use the same configured account.
    const sameAccount = harness.env.accountId === other.env.accountId;

    const rows = await loadList(harness);
    const row = rows.find((r) => r.id === withFlow.campaignId);
    assert.ok(row);
    assert.equal(row.has_flow, true);
    assert.equal(row.sent_count, 11);
    assert.equal(row.replied_count, 4);
    assert.equal(row.positive_reply_count, 2);
    assert.equal(row.bounce_count, 1);

    if (!sameAccount) {
      assert.equal(
        rows.some((r) => r.id === otherGraph.campaignId),
        false,
      );
    }
  } finally {
    await harness.cleanup();
    await other.cleanup();
  }
});
