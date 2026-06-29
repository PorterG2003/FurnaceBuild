import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SchedulerWorker } from '../../../workers/scheduler-worker/src/worker';
import { DatabaseClient as SchedulerDatabaseClient } from '../../../workers/scheduler-worker/src/database';
import { callAddGlobalLeadsToCampaignRpc } from './add-to-campaign-rpc-helpers';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

async function loadLeadGlobalId(harness: CampaignDbHarness, leadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('global_lead_id, email')
    .eq('id', leadId)
    .single();
  assert.equal(error, null);
  assert.ok(data?.global_lead_id, 'expected global_lead_id on lead row');
  return data!.global_lead_id as string;
}

async function loadEnrollmentsForLeadIds(harness: CampaignDbHarness, leadIds: string[]) {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('id, lead_id, campaign_id, current_node_id, state, next_run_at')
    .in('lead_id', leadIds)
    .is('deleted_at', null);
  assert.equal(error, null);
  return data ?? [];
}

async function loadEnrollmentRows(harness: CampaignDbHarness, enrollmentIds: string[]) {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('id, campaign_id, lead_id, current_node_id, state, next_run_at, flow_position, created_at, updated_at')
    .in('id', enrollmentIds);
  assert.equal(error, null);
  return (data ?? []) as any[];
}

async function processEnrollmentIds(
  harness: CampaignDbHarness,
  worker: SchedulerWorker,
  enrollmentIds: string[],
) {
  const enrollments = await loadEnrollmentRows(harness, enrollmentIds);
  const grouped = (worker as any).groupEnrollmentsByCampaign(enrollments);
  const contexts = await (worker as any).loadCampaignContexts(grouped);
  for (const enrollment of enrollments) {
    await (worker as any).processEnrollment(enrollment, contexts.get(enrollment.campaign_id));
  }
}

async function countLeadsInCampaign(harness: CampaignDbHarness, campaignId: string, email: string) {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('email', email)
    .is('deleted_at', null);
  assert.equal(error, null);
  return data?.length ?? 0;
}

test('addGlobalLeadsToCampaign RPC creates a lead row and active enrollment for a net-new person', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-new') });
  const sourceEmail = `source-new-${harness.namespace}@furnace.test`;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Add Source A',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email: sourceEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target B',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const sourceLeadId = sourceGraph.leadsByKey.get('source')!.leadId;
    const globalLeadId = await loadLeadGlobalId(harness, sourceLeadId);
    assert.equal(globalLeadId, hashGlobalLeadId(sourceEmail));

    const summary = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    assert.equal(summary.created, 1);
    assert.equal(summary.updated, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);
    assert.ok(summary.enrolled >= 1);
    assert.equal(await countLeadsInCampaign(harness, targetGraph.campaignId, sourceEmail), 1);

    const { data: targetLeads, error: targetLeadsError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', targetGraph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(targetLeadsError, null);
    assert.equal(targetLeads?.length, 1);

    const enrollments = await loadEnrollmentsForLeadIds(
      harness,
      targetLeads!.map((row) => row.id as string),
    );
    assert.equal(enrollments.length, 1);
    assert.equal(enrollments[0]?.state, 'active');
    assert.ok(enrollments[0]?.next_run_at);
  } finally {
    await harness.cleanup();
  }
});

test('addGlobalLeadsToCampaign adds a lead missing a required custom field and counts it incomplete', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-incomplete') });
  const sourceEmail = `source-incomplete-${harness.namespace}@furnace.test`;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Add Source Incomplete',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email: sourceEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    // Target campaign requires personalization keys the source lead does not have.
    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target Incomplete',
      status: 'running',
      flowKind: 'emailOnly',
      leadSourceCustomFieldKeys: ['Industry', 'Title'],
      leads: [],
    });

    const globalLeadId = await loadLeadGlobalId(harness, sourceGraph.leadsByKey.get('source')!.leadId);

    const summary = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    assert.equal(summary.created, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.incomplete, 1);
    assert.equal(summary.failed, 0);
    assert.ok(summary.enrolled >= 1);

    const { data: targetLeads, error: targetLeadsError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', targetGraph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(targetLeadsError, null);
    assert.equal(targetLeads?.length, 1);

    const enrollments = await loadEnrollmentsForLeadIds(
      harness,
      targetLeads!.map((row) => row.id as string),
    );
    assert.equal(enrollments.length, 1);
    assert.equal(enrollments[0]?.state, 'active');
    assert.ok(enrollments[0]?.next_run_at);
  } finally {
    await harness.cleanup();
  }
});

test('addGlobalLeadsToCampaign still skips a person with no email in the account', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-no-email') });

  try {
    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target No Email',
      status: 'running',
      flowKind: 'emailOnly',
      leadSourceCustomFieldKeys: ['Industry'],
      leads: [],
    });

    // A global lead id that does not resolve to any lead row in the account.
    const summary = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [hashGlobalLeadId(`ghost-${harness.namespace}@furnace.test`)],
    });

    assert.equal(summary.created, 0);
    assert.equal(summary.updated, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.incomplete, 0);
  } finally {
    await harness.cleanup();
  }
});

test('addGlobalLeadsToCampaign RPC updates an existing target lead without duplicating rows or enrollments', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-existing') });
  const email = `existing-${harness.namespace}@furnace.test`;
  const now = Date.now();

  try {
    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target Existing',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'existing',
          email,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const existingLead = targetGraph.leadsByKey.get('existing')!;
    const globalLeadId = await loadLeadGlobalId(harness, existingLead.leadId);
    const enrollmentBefore = await loadEnrollmentRows(harness, [existingLead.enrollmentId!]);
    const currentNodeBefore = enrollmentBefore[0]?.current_node_id;

    const summary = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    assert.equal(summary.created, 0);
    assert.equal(summary.updated, 1);
    assert.equal(summary.failed, 0);
    assert.equal(await countLeadsInCampaign(harness, targetGraph.campaignId, email), 1);

    const enrollmentsAfter = await loadEnrollmentsForLeadIds(harness, [existingLead.leadId]);
    assert.equal(enrollmentsAfter.length, 1);
    assert.equal(enrollmentsAfter[0]?.id, existingLead.enrollmentId);
    assert.equal(enrollmentsAfter[0]?.current_node_id, currentNodeBefore);
    assert.equal(enrollmentsAfter[0]?.state, 'active');
  } finally {
    await harness.cleanup();
  }
});

test('addGlobalLeadsToCampaign is idempotent on repeat calls', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-idempotent') });
  const email = `idempotent-${harness.namespace}@furnace.test`;

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Add Source Idempotent',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target Idempotent',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const globalLeadId = await loadLeadGlobalId(harness, sourceGraph.leadsByKey.get('source')!.leadId);

    const first = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });
    const second = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [globalLeadId],
    });

    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(await countLeadsInCampaign(harness, targetGraph.campaignId, email), 1);

    const enrollments = await loadEnrollmentsForLeadIds(harness, [
      (
        await harness.supabase
          .from('leads')
          .select('id')
          .eq('campaign_id', targetGraph.campaignId)
          .eq('global_lead_id', globalLeadId)
          .single()
      ).data!.id as string,
    ]);
    assert.equal(enrollments.length, 1);
  } finally {
    await harness.cleanup();
  }
});

test('addGlobalLeadsToCampaign keeps old and new leads eligible for scheduler processing together', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('add-mixed-flow') });
  const existingEmail = `mixed-existing-${harness.namespace}@furnace.test`;
  const newEmail = `mixed-new-${harness.namespace}@furnace.test`;
  const now = Date.now();

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Add Source Mixed',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'incoming',
          email: newEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Add Target Mixed',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'incumbent',
          email: existingEmail,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const incumbent = targetGraph.leadsByKey.get('incumbent')!;
    const incomingGlobalId = await loadLeadGlobalId(
      harness,
      sourceGraph.leadsByKey.get('incoming')!.leadId,
    );

    const summary = await callAddGlobalLeadsToCampaignRpc(harness, {
      campaignId: targetGraph.campaignId,
      globalLeadIds: [await loadLeadGlobalId(harness, incumbent.leadId), incomingGlobalId],
    });

    assert.equal(summary.created, 1);
    assert.equal(summary.updated, 1);
    assert.equal(summary.failed, 0);

    const { data: targetLeadRows, error: targetLeadRowsError } = await harness.supabase
      .from('leads')
      .select('id, email')
      .eq('campaign_id', targetGraph.campaignId)
      .is('deleted_at', null)
      .in('email', [existingEmail, newEmail]);
    assert.equal(targetLeadRowsError, null);
    assert.equal(targetLeadRows?.length, 2);

    const enrollments = await loadEnrollmentsForLeadIds(
      harness,
      (targetLeadRows ?? []).map((row) => row.id as string),
    );
    assert.equal(enrollments.length, 2);
    for (const enrollment of enrollments) {
      assert.equal(enrollment.state, 'active');
      assert.ok(enrollment.next_run_at);
    }

    const schedulerWorker = new SchedulerWorker({
      supabase: harness.supabase as any,
      databaseClient: new SchedulerDatabaseClient(harness.supabase as any),
    });

    await processEnrollmentIds(
      harness,
      schedulerWorker,
      enrollments.map((row) => row.id as string),
    );

    const leadIds = (targetLeadRows ?? []).map((row) => row.id as string);
    const enrollmentsAfter = await loadEnrollmentsForLeadIds(harness, leadIds);
    assert.equal(enrollmentsAfter.length, 2);
    for (const enrollment of enrollmentsAfter) {
      assert.equal(enrollment.state, 'active');
    }

    const progressed = enrollmentsAfter.filter((row) => row.current_node_id != null).length;
    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, lead_id, status')
      .eq('campaign_id', targetGraph.campaignId)
      .in('lead_id', leadIds);
    assert.equal(jobsError, null);
    assert.ok(
      progressed >= 1 || (jobs ?? []).length >= 1,
      'expected scheduler processing to advance an enrollment or create campaign work for old and new leads',
    );
  } finally {
    await harness.cleanup();
  }
});
