import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_CAMPAIGN_SCHEDULE,
  DEFAULT_SENDING_INTERVAL_SECONDS,
} from '../../campaigns/utils';
import type { Database } from '../../supabase/types/database';
import { duplicateCampaignWithClient } from '../../supabase/services/campaigns/duplicate-campaign-with-client';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function asDbClient(client: CampaignDbHarness['supabase']): SupabaseClient<Database> {
  return client as SupabaseClient<Database>;
}

async function cleanupDuplicatedCampaign(harness: CampaignDbHarness, campaignId: string | null): Promise<void> {
  if (!campaignId) {
    return;
  }

  const cleanupSteps: Array<{ table: string; column: string }> = [
    { table: 'campaign_tag_assignments', column: 'campaign_id' },
    { table: 'campaign_mailboxes', column: 'campaign_id' },
    { table: 'message_jobs', column: 'campaign_id' },
    { table: 'enrollments', column: 'campaign_id' },
    { table: 'leads', column: 'campaign_id' },
    { table: 'nodes', column: 'campaign_id' },
    { table: 'campaign_flow_versions', column: 'campaign_id' },
    { table: 'campaign_stats', column: 'campaign_id' },
    { table: 'campaigns', column: 'id' },
  ];

  for (const step of cleanupSteps) {
    const { error } = await harness.supabase.from(step.table).delete().eq(step.column, campaignId);
    assert.equal(error, null, `expected cleanup for ${step.table}`);
  }
}

async function loadCampaignMailboxIds(harness: CampaignDbHarness, campaignId: string): Promise<string[]> {
  const { data, error } = await harness.supabase
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', campaignId)
    .order('mailbox_id', { ascending: true });
  assert.equal(error, null);
  return (data ?? []).map((row: any) => row.mailbox_id as string);
}

async function loadCampaignTagIds(harness: CampaignDbHarness, campaignId: string): Promise<string[]> {
  const { data, error } = await harness.supabase
    .from('campaign_tag_assignments')
    .select('tag_id')
    .eq('campaign_id', campaignId)
    .order('tag_id', { ascending: true });
  assert.equal(error, null);
  return (data ?? []).map((row: any) => row.tag_id as string);
}

test('duplicateCampaign copies requested settings and leads without copying operational state', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('duplicate-full') });
  const createdTagIds: string[] = [];
  let duplicatedCampaignId: string | null = null;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Duplicate Source',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'alpha',
          email: `alpha-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          jobs: [buildCampaignJob({ key: 'job-alpha', mailboxKey: 'mailbox-1' })],
        }),
        buildCampaignLead({
          key: 'beta',
          email: `beta-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-2',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'wait-1',
          }),
        }),
      ],
    });

    const { data: sourceCampaign, error: sourceCampaignError } = await harness.supabase
      .from('campaigns')
      .select('id, name, status, schedule, jitter_percentage, sending_interval_seconds, flow_data')
      .eq('id', sourceGraph.campaignId)
      .single();
    assert.equal(sourceCampaignError, null);
    assert.ok(sourceCampaign);

    const tagRows = [
      {
        id: randomUUID(),
        account_id: sourceGraph.accountId,
        name: `Tag A ${harness.namespace}`,
        color: '#f97316',
      },
      {
        id: randomUUID(),
        account_id: sourceGraph.accountId,
        name: `Tag B ${harness.namespace}`,
        color: '#22c55e',
      },
    ];
    createdTagIds.push(...tagRows.map((tag) => tag.id));

    const { error: tagInsertError } = await harness.supabase.from('campaign_tags').insert(tagRows as any);
    assert.equal(tagInsertError, null);

    const { error: tagAssignmentError } = await harness.supabase.from('campaign_tag_assignments').insert(
      tagRows.map((tag) => ({
        campaign_id: sourceGraph.campaignId,
        tag_id: tag.id,
        account_id: sourceGraph.accountId,
      })) as any,
    );
    assert.equal(tagAssignmentError, null);

    const { error: statsError } = await harness.supabase.from('campaign_stats').upsert({
      campaign_id: sourceGraph.campaignId,
      account_id: sourceGraph.accountId,
      sent_count: 7,
      replied_count: 2,
      positive_reply_count: 1,
      bounce_count: 0,
    } as any);
    assert.equal(statsError, null);

    const duplicatedCampaign = await duplicateCampaignWithClient(asDbClient(harness.supabase), sourceGraph.campaignId, {
      name: 'Duplicate Copy',
      ownerId: harness.env.ownerUserId,
      accountId: sourceGraph.accountId,
      copySettings: true,
      copyLeads: true,
    });
    duplicatedCampaignId = duplicatedCampaign.id;

    assert.notEqual(duplicatedCampaign.id, sourceGraph.campaignId);
    assert.equal(duplicatedCampaign.name, 'Duplicate Copy');
    assert.equal(duplicatedCampaign.status, 'draft');
    assert.deepEqual(duplicatedCampaign.schedule, sourceCampaign!.schedule);
    assert.equal(duplicatedCampaign.jitter_percentage, sourceCampaign!.jitter_percentage);
    assert.equal(duplicatedCampaign.sending_interval_seconds, sourceCampaign!.sending_interval_seconds);
    assert.deepEqual(duplicatedCampaign.flow_data, sourceCampaign!.flow_data);

    const sourceMailboxIds = [...sourceGraph.mailboxIdsByKey.values()].sort();
    const duplicatedMailboxIds = await loadCampaignMailboxIds(harness, duplicatedCampaign.id);
    assert.deepEqual(duplicatedMailboxIds, sourceMailboxIds);

    const duplicatedTagIds = await loadCampaignTagIds(harness, duplicatedCampaign.id);
    assert.deepEqual(duplicatedTagIds, createdTagIds.slice().sort());

    const { data: duplicatedLeadRows, error: duplicatedLeadError } = await harness.supabase
      .from('leads')
      .select('id, email, global_lead_id, mailbox_id')
      .eq('campaign_id', duplicatedCampaign.id)
      .is('deleted_at', null)
      .order('email', { ascending: true });
    assert.equal(duplicatedLeadError, null);
    assert.equal((duplicatedLeadRows ?? []).length, 2);

    const { data: sourceLeadRows, error: sourceLeadError } = await harness.supabase
      .from('leads')
      .select('id, email, global_lead_id, mailbox_id')
      .eq('campaign_id', sourceGraph.campaignId)
      .is('deleted_at', null)
      .order('email', { ascending: true });
    assert.equal(sourceLeadError, null);
    assert.equal((sourceLeadRows ?? []).length, 2);

    assert.deepEqual(
      (duplicatedLeadRows ?? []).map((row: any) => row.email),
      (sourceLeadRows ?? []).map((row: any) => row.email),
    );
    assert.deepEqual(
      (duplicatedLeadRows ?? []).map((row: any) => row.global_lead_id),
      (sourceLeadRows ?? []).map((row: any) => row.global_lead_id),
    );
    assert.deepEqual(
      (duplicatedLeadRows ?? []).map((row: any) => row.mailbox_id),
      (sourceLeadRows ?? []).map((row: any) => row.mailbox_id),
    );
    assert.equal(
      (duplicatedLeadRows ?? []).some((row: any) => (sourceLeadRows ?? []).some((sourceRow: any) => sourceRow.id === row.id)),
      false,
    );

    const { data: duplicateEnrollments, error: duplicateEnrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id)
      .is('deleted_at', null);
    assert.equal(duplicateEnrollmentError, null);
    assert.equal((duplicateEnrollments ?? []).length, 0);

    const { data: duplicateJobs, error: duplicateJobsError } = await harness.supabase
      .from('message_jobs')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id);
    assert.equal(duplicateJobsError, null);
    assert.equal((duplicateJobs ?? []).length, 0);

    const { data: duplicateStats, error: duplicateStatsError } = await harness.supabase
      .from('campaign_stats')
      .select('sent_count, replied_count, positive_reply_count, bounce_count')
      .eq('campaign_id', duplicatedCampaign.id);
    assert.equal(duplicateStatsError, null);
    assert.equal((duplicateStats ?? []).length, 1);
    assert.deepEqual(duplicateStats?.[0], {
      sent_count: 0,
      replied_count: 0,
      positive_reply_count: 0,
      bounce_count: 0,
    });

    const { data: duplicateNodes, error: duplicateNodesError } = await harness.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id)
      .is('deleted_at', null);
    assert.equal(duplicateNodesError, null);
    assert.ok((duplicateNodes ?? []).length >= 2);

    const { data: duplicateFlowVersions, error: duplicateFlowVersionError } = await harness.supabase
      .from('campaign_flow_versions')
      .select('version_number')
      .eq('campaign_id', duplicatedCampaign.id)
      .order('version_number', { ascending: true });
    assert.equal(duplicateFlowVersionError, null);
    assert.deepEqual((duplicateFlowVersions ?? []).map((row: any) => row.version_number), [1]);
  } finally {
    await cleanupDuplicatedCampaign(harness, duplicatedCampaignId);
    if (createdTagIds.length > 0) {
      const { error: deleteAssignmentsError } = await harness.supabase
        .from('campaign_tag_assignments')
        .delete()
        .in('tag_id', createdTagIds);
      assert.equal(deleteAssignmentsError, null);

      const { error: deleteTagsError } = await harness.supabase
        .from('campaign_tags')
        .delete()
        .in('id', createdTagIds);
      assert.equal(deleteTagsError, null);
    }
    await harness.cleanup();
  }
});

test('duplicateCampaign leaves settings and leads behind when toggles are off', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('duplicate-minimal') });
  let duplicatedCampaignId: string | null = null;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Duplicate Minimal Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'solo',
          email: `solo-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
        }),
      ],
    });

    const duplicatedCampaign = await duplicateCampaignWithClient(asDbClient(harness.supabase), sourceGraph.campaignId, {
      name: 'Blank Copy',
      ownerId: harness.env.ownerUserId,
      accountId: sourceGraph.accountId,
      copySettings: false,
      copyLeads: false,
    });
    duplicatedCampaignId = duplicatedCampaign.id;

    assert.equal(duplicatedCampaign.name, 'Blank Copy');
    assert.equal(duplicatedCampaign.status, 'draft');
    assert.equal(duplicatedCampaign.flow_data, null);
    // copySettings=false still creates a new campaign row, so DB create defaults apply
    // (Central 9–5 / 24-minute interval from #215). Explicit null remains 24/7.
    assert.deepEqual(duplicatedCampaign.schedule, DEFAULT_CAMPAIGN_SCHEDULE);
    assert.equal(duplicatedCampaign.sending_interval_seconds, DEFAULT_SENDING_INTERVAL_SECONDS);

    assert.deepEqual(await loadCampaignMailboxIds(harness, duplicatedCampaign.id), []);
    assert.deepEqual(await loadCampaignTagIds(harness, duplicatedCampaign.id), []);

    const { data: duplicateLeads, error: duplicateLeadsError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id)
      .is('deleted_at', null);
    assert.equal(duplicateLeadsError, null);
    assert.equal((duplicateLeads ?? []).length, 0);

    const { data: duplicateNodes, error: duplicateNodesError } = await harness.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id)
      .is('deleted_at', null);
    assert.equal(duplicateNodesError, null);
    assert.equal((duplicateNodes ?? []).length, 0);

    const { data: duplicateFlowVersions, error: duplicateFlowVersionError } = await harness.supabase
      .from('campaign_flow_versions')
      .select('id')
      .eq('campaign_id', duplicatedCampaign.id);
    assert.equal(duplicateFlowVersionError, null);
    assert.equal((duplicateFlowVersions ?? []).length, 0);
  } finally {
    await cleanupDuplicatedCampaign(harness, duplicatedCampaignId);
    await harness.cleanup();
  }
});
