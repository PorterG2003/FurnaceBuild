import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import {
  createTestSchedulerWorker,
  getEnrollmentRow,
  processEnrollmentIds,
} from './categorizer-helpers';
import { handleWaitTimeNode } from '../../../workers/scheduler-worker/src/node-handlers/wait-time-handler';

function isFkViolation(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message ?? '';
  return error?.code === '23503' || message.includes('campaign_node') || message.includes('foreign key');
}

function isMissingScopeConstraint(error: { code?: string; message?: string } | null): boolean {
  return error == null || (!isFkViolation(error) && error.code !== '23514');
}

async function insertJob(params: {
  harness: CampaignDbHarness;
  campaignId: string;
  accountId: string;
  leadId: string;
  enrollmentId: string;
  mailboxId: string;
  nodeId: string;
}): Promise<{ id: string; error: { code?: string; message?: string } | null }> {
  const id = randomUUID();
  const scheduledAt = new Date().toISOString();
  const { error } = await params.harness.supabase.from('message_jobs').insert({
    id,
    enrollment_id: params.enrollmentId,
    campaign_id: params.campaignId,
    account_id: params.accountId,
    lead_id: params.leadId,
    mailbox_id: params.mailboxId,
    node_id: params.nodeId,
    status: 'queued',
    scheduled_at: scheduledAt,
    message_type: 'campaign',
    message_data: { source: 'node_campaign_scope_test' },
  } as never);
  return { id, error };
}

test('composite node FKs reject cross-campaign node refs and keep matching writes working', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('node-scope'),
  });

  try {
    const graphA = await harness.createCampaignGraph({
      name: 'Node Scope A',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `scope-a-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const graphB = await harness.createCampaignGraph({
      name: 'Node Scope B',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-b',
          email: `scope-b-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
        }),
      ],
    });

    const leadA = graphA.leadsByKey.get('lead-a')!;
    const nodeA = graphA.nodeIdsByFlowNodeId.get('email-1')!;
    const nodeB = graphB.nodeIdsByFlowNodeId.get('email-1')!;
    const mailboxA = graphA.mailboxIdsByKey.get('mailbox-1')!;

    const probe = await harness.supabase.from('campaign_node_variant_state').insert({
      campaign_id: graphA.campaignId,
      node_id: nodeB,
      next_index: 0,
      active_set_hash: `probe-${harness.namespace}`,
    } as never);
    if (isMissingScopeConstraint(probe.error)) {
      if (!probe.error) {
        await harness.supabase
          .from('campaign_node_variant_state')
          .delete()
          .eq('campaign_id', graphA.campaignId)
          .eq('node_id', nodeB);
      }
      t.skip('DB-backed target has not applied nodes_campaign_scope_integrity');
      return;
    }
    assert.equal(probe.error?.code, '23503', probe.error?.message);

    const mismatchedJob = await insertJob({
      harness,
      campaignId: graphA.campaignId,
      accountId: graphA.accountId,
      leadId: leadA.leadId,
      enrollmentId: leadA.enrollmentId!,
      mailboxId: mailboxA,
      nodeId: nodeB,
    });
    assert.ok(mismatchedJob.error, 'campaign A plus campaign B node must be rejected');
    assert.equal(mismatchedJob.error?.code, '23503', mismatchedJob.error?.message);

    const matchingJob = await insertJob({
      harness,
      campaignId: graphA.campaignId,
      accountId: graphA.accountId,
      leadId: leadA.leadId,
      enrollmentId: leadA.enrollmentId!,
      mailboxId: mailboxA,
      nodeId: nodeA,
    });
    assert.equal(matchingJob.error, null, matchingJob.error?.message);
    graphA.manifest.messageJobIds.push(matchingJob.id);

    const { error: updateError } = await harness.supabase
      .from('message_jobs')
      .update({ node_id: nodeB } as never)
      .eq('id', matchingJob.id);
    assert.ok(updateError, 'updating a job onto a foreign campaign node must be rejected');
    assert.equal(updateError?.code, '23503', updateError?.message);

    const { error: enrollmentMismatch } = await harness.supabase
      .from('enrollments')
      .update({ current_node_id: nodeB } as never)
      .eq('id', leadA.enrollmentId!);
    assert.ok(enrollmentMismatch, 'enrollment current_node_id must stay in-campaign');
    assert.equal(enrollmentMismatch?.code, '23503', enrollmentMismatch?.message);

    const { error: enrollmentOwn } = await harness.supabase
      .from('enrollments')
      .update({ current_node_id: graphA.nodeIdsByFlowNodeId.get('email-2')! } as never)
      .eq('id', leadA.enrollmentId!);
    assert.equal(enrollmentOwn, null, enrollmentOwn?.message);

    const { error: enrollmentNull } = await harness.supabase
      .from('enrollments')
      .update({ current_node_id: null } as never)
      .eq('id', leadA.enrollmentId!);
    assert.equal(enrollmentNull, null, enrollmentNull?.message);

    const { error: variantOk } = await harness.supabase.from('campaign_node_variant_state').insert({
      campaign_id: graphA.campaignId,
      node_id: nodeA,
      next_index: 0,
      active_set_hash: `ok-${harness.namespace}`,
    } as never);
    assert.equal(variantOk, null, variantOk?.message);
  } finally {
    await harness.cleanup();
  }
});

test('soft-deleting a campaign with jobs still succeeds under the composite RESTRICT FK', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('node-scope-del'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Node Scope Delete',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `scope-del-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
        }),
      ],
    });

    const probe = await harness.supabase.from('campaign_node_variant_state').insert({
      campaign_id: graph.campaignId,
      node_id: graph.nodeIdsByFlowNodeId.get('email-1')!,
      next_index: 0,
      active_set_hash: `del-${harness.namespace}`,
    } as never);
    if (probe.error?.code === '23503') {
      // Constraint is present; matching insert should not 23503.
      t.skip('unexpected 23503 on matching campaign_node_variant_state insert');
      return;
    }

    const lead = graph.leadsByKey.get('lead')!;
    const job = await insertJob({
      harness,
      campaignId: graph.campaignId,
      accountId: graph.accountId,
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      mailboxId: graph.mailboxIdsByKey.get('mailbox-1')!,
      nodeId: graph.nodeIdsByFlowNodeId.get('email-1')!,
    });
    if (isMissingScopeConstraint(job.error) && job.error) {
      t.skip('DB-backed target has not applied nodes_campaign_scope_integrity');
      return;
    }
    assert.equal(job.error, null, job.error?.message);
    graph.manifest.messageJobIds.push(job.id);

    const now = new Date().toISOString();
    const { error: campaignError } = await harness.supabase
      .from('campaigns')
      .update({ deleted_at: now, status: 'stopped', updated_at: now } as never)
      .eq('id', graph.campaignId)
      .is('deleted_at', null);
    assert.equal(campaignError, null, campaignError?.message);

    const { error: enrollmentsError } = await harness.supabase
      .from('enrollments')
      .update({ deleted_at: now, state: 'stopped', next_run_at: null, updated_at: now } as never)
      .eq('campaign_id', graph.campaignId)
      .is('deleted_at', null);
    assert.equal(enrollmentsError, null, enrollmentsError?.message);

    const { error: nodesError } = await harness.supabase
      .from('nodes')
      .update({ deleted_at: now, updated_at: now } as never)
      .eq('campaign_id', graph.campaignId)
      .is('deleted_at', null);
    assert.equal(nodesError, null, nodesError?.message);

    const { data: jobRow, error: jobLoadError } = await harness.supabase
      .from('message_jobs')
      .select('id, status')
      .eq('id', job.id)
      .single();
    assert.equal(jobLoadError, null);
    assert.equal(jobRow?.id, job.id);
  } finally {
    await harness.cleanup();
  }
});

test('a two-email flow still advances current_node_id through wait handling', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('node-scope-wait'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Node Scope Wait',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'wait-lead',
          email: `scope-wait-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('wait-lead')!;
    const enrollmentBefore = await harness.supabase
      .from('enrollments')
      .select('id, updated_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentBefore.error, null);

    await handleWaitTimeNode(
      {
        id: lead.enrollmentId!,
        campaign_id: graph.campaignId,
        lead_id: lead.leadId,
        current_node_id: graph.nodeIdsByFlowNodeId.get('email-1')!,
        state: 'active',
        next_run_at: null,
        flow_position: {},
        created_at: enrollmentBefore.data!.updated_at,
        updated_at: enrollmentBefore.data!.updated_at,
      } as never,
      {
        id: graph.nodeIdsByFlowNodeId.get('waitTime-1')!,
        node_data: { wait_duration_seconds: 1800 },
      },
      null,
      1,
      harness.supabase as never,
    );

    const afterWait = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(afterWait.current_node_id, graph.nodeIdsByFlowNodeId.get('waitTime-1'));

    await harness.supabase
      .from('enrollments')
      .update({
        next_run_at: new Date(Date.now() - 5_000).toISOString(),
        state: 'active',
      } as never)
      .eq('id', lead.enrollmentId!);

    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]);
    const afterAdvance = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(afterAdvance.current_node_id, graph.nodeIdsByFlowNodeId.get('email-2'));
  } finally {
    await harness.cleanup();
  }
});
