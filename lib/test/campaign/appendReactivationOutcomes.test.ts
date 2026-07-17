import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Json } from '../../supabase/types/database';
import {
  FLOW_TOAST_APPEND_REACTIVATED_ONE,
  formatFlowAppendReactivatedToast,
} from '../../campaigns/flow/lifecycle';
import { updateCampaignFlowDataWithClient } from '../../supabase/services/campaigns/update-campaign-flow-with-client';
import { SchedulerWorker } from '../../../workers/scheduler-worker/src/worker';
import { DatabaseClient as SchedulerDatabaseClient } from '../../../workers/scheduler-worker/src/database';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

type CampaignFlowData = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

const APPENDED_EMAIL_FLOW_NODE_ID = 'email-4';
const MID_FLOW_EMAIL_FLOW_NODE_ID = 'email-3';
const SECOND_APPEND_EMAIL_FLOW_NODE_ID = 'email-4';

async function loadEnrollment(
  harness: CampaignDbHarness,
  enrollmentId: string,
) {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('id, state, current_node_id, next_run_at, stopped_reason')
    .eq('id', enrollmentId)
    .single();
  assert.equal(error, null);
  return data!;
}

async function pollNodeIdByFlowNodeId(
  harness: CampaignDbHarness,
  campaignId: string,
  flowNodeId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { data, error } = await harness.supabase
      .from('nodes')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('flow_node_id', flowNodeId)
      .is('deleted_at', null)
      .maybeSingle();
    assert.equal(error, null);
    if (data?.id) {
      return data.id as string;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for node ${flowNodeId} on campaign ${campaignId}`);
}

function appendEmailAfterLeaf(
  flowData: CampaignFlowData,
  leafFlowNodeId: string,
  newNodeId: string,
): CampaignFlowData {
  return {
    nodes: [
      ...flowData.nodes,
      {
        id: newNodeId,
        type: 'email',
        position: { x: 940, y: 0 },
        data: {
          label: 'Appended Follow-up',
          send_mode: 'new',
          variants: [
            {
              id: randomUUID(),
              label: 'A',
              subject: 'Appended step for {{name}}',
              template: 'Hi {{name}} - appended follow-up after completed leaf.',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
    ],
    edges: [
      ...flowData.edges,
      {
        id: `e-append-${newNodeId}`,
        source: leafFlowNodeId,
        target: newNodeId,
      },
    ],
  };
}

async function processEnrollment(
  harness: CampaignDbHarness,
  worker: SchedulerWorker,
  enrollmentId: string,
) {
  const { data: enrollment, error } = await harness.supabase
    .from('enrollments')
    .select('id, campaign_id, lead_id, current_node_id, state, next_run_at, flow_position, created_at, updated_at')
    .eq('id', enrollmentId)
    .single();
  assert.equal(error, null);

  const grouped = (worker as any).groupEnrollmentsByCampaign([enrollment]);
  const contexts = await (worker as any).loadCampaignContexts(grouped);
  await (worker as any).processEnrollment(enrollment, contexts.get(enrollment!.campaign_id));
}

function createSchedulerWorker(harness: CampaignDbHarness): SchedulerWorker {
  return new SchedulerWorker({
    supabase: harness.supabase as any,
    databaseClient: new SchedulerDatabaseClient({
      supabase: harness.supabase as any,
      batchSize: 100,
      pollIntervalMs: 1000,
    }) as any,
  });
}

test('paused append reactivates completed enrollments at former leaf and leaves stopped enrollments unchanged', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('append-reactivation') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Append Reactivation',
      status: 'paused',
      flowKind: 'emailWaitEmail',
      schedule: {
        timezone: 'UTC',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      } as unknown as Json,
      leads: [
        buildCampaignLead({
          key: 'completed-leaf',
          email: `completed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'completed',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'email-2-sent',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              sentAt: new Date(Date.now() - 60_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'stopped-leaf',
          email: `stopped-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const completedEnrollmentId = graph.leadsByKey.get('completed-leaf')!.enrollmentId!;
    const stoppedEnrollmentId = graph.leadsByKey.get('stopped-leaf')!.enrollmentId!;
    const leafNodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const { data: campaignBefore, error: campaignBeforeError } = await harness.supabase
      .from('campaigns')
      .select('flow_data, status')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignBeforeError, null);
    assert.equal(campaignBefore?.status, 'paused');

    const currentFlow = campaignBefore!.flow_data as CampaignFlowData;
    const outgoingFromLeaf = currentFlow.edges.filter((edge) => edge.source === 'email-2');
    assert.equal(outgoingFromLeaf.length, 0, 'precondition: email-2 must be a former leaf');

    const appendedFlow = appendEmailAfterLeaf(currentFlow, 'email-2', APPENDED_EMAIL_FLOW_NODE_ID);
    const saveResult = await updateCampaignFlowDataWithClient(harness.supabase, {
      campaignId: graph.campaignId,
      accountId: harness.env.accountId,
      flowData: appendedFlow as unknown as Json,
      changeSource: 'append_reactivation_test',
    });

    assert.equal(saveResult.reactivated_count, 1);
    assert.equal(formatFlowAppendReactivatedToast(saveResult.reactivated_count), FLOW_TOAST_APPEND_REACTIVATED_ONE);

    const completedAfterSave = await loadEnrollment(harness, completedEnrollmentId);
    const stoppedAfterSave = await loadEnrollment(harness, stoppedEnrollmentId);

    assert.equal(completedAfterSave.state, 'active');
    assert.equal(completedAfterSave.current_node_id, leafNodeId);
    assert.ok(completedAfterSave.next_run_at, 'reactivated enrollment should be schedulable after resume');

    assert.equal(stoppedAfterSave.state, 'stopped');
    assert.equal(stoppedAfterSave.current_node_id, leafNodeId);
    assert.equal(stoppedAfterSave.stopped_reason, 'replied');

    const { error: resumeError } = await harness.supabase.rpc('resume_campaign_and_reschedule_jobs', {
      p_campaign_id: graph.campaignId,
      p_pause_reason: 'Campaign paused',
    });
    assert.equal(resumeError, null);

    const { data: campaignRunning, error: campaignRunningError } = await harness.supabase
      .from('campaigns')
      .select('status')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignRunningError, null);
    assert.equal(campaignRunning?.status, 'running');

    const appendedNodeId = await pollNodeIdByFlowNodeId(
      harness,
      graph.campaignId,
      APPENDED_EMAIL_FLOW_NODE_ID,
    );

    const worker = createSchedulerWorker(harness);
    await processEnrollment(harness, worker, completedEnrollmentId);

    const completedAfterScheduler = await loadEnrollment(harness, completedEnrollmentId);
    assert.equal(completedAfterScheduler.state, 'active');
    assert.equal(completedAfterScheduler.current_node_id, appendedNodeId);
    assert.ok(completedAfterScheduler.next_run_at);

    const stoppedAfterScheduler = await loadEnrollment(harness, stoppedEnrollmentId);
    assert.equal(stoppedAfterScheduler.state, 'stopped');
    assert.equal(stoppedAfterScheduler.current_node_id, leafNodeId);
  } finally {
    await harness.cleanup();
  }
});

test('append after later tip also reactivates completed enrollments stranded on older non-leaf nodes', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('append-older-leaf'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Older Leaf Append Reactivation',
      status: 'paused',
      flowKind: 'emailWaitEmail',
      schedule: {
        timezone: 'UTC',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      } as unknown as Json,
      leads: [
        buildCampaignLead({
          key: 'older-completed',
          email: `older-completed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'completed',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'email-2-sent',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              sentAt: new Date(Date.now() - 120_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'tip-completed',
          email: `tip-completed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'completed',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'email-2-sent-tip',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              sentAt: new Date(Date.now() - 120_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'older-stopped',
          email: `older-stopped-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
            stoppedReason: 'replied',
            stoppedAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const olderCompletedId = graph.leadsByKey.get('older-completed')!.enrollmentId!;
    const tipCompletedId = graph.leadsByKey.get('tip-completed')!.enrollmentId!;
    const olderStoppedId = graph.leadsByKey.get('older-stopped')!.enrollmentId!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const { data: campaignBefore, error: campaignBeforeError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignBeforeError, null);

    const baseFlow = campaignBefore!.flow_data as CampaignFlowData;
    const midFlow = appendEmailAfterLeaf(baseFlow, 'email-2', MID_FLOW_EMAIL_FLOW_NODE_ID);
    const firstAppend = await updateCampaignFlowDataWithClient(harness.supabase, {
      campaignId: graph.campaignId,
      accountId: harness.env.accountId,
      flowData: midFlow as unknown as Json,
      changeSource: 'append_older_leaf_setup',
    });
    // Both completed enrollments sit on email-2, which becomes a non-leaf.
    assert.equal(firstAppend.reactivated_count, 2);

    const midEmailNodeId = await pollNodeIdByFlowNodeId(
      harness,
      graph.campaignId,
      MID_FLOW_EMAIL_FLOW_NODE_ID,
    );

    // Simulate multi-generation stranding: older leaf stays completed on email-2
    // while tip cohort completes on email-3 after the mid-flow already exists.
    const { error: strandOlderError } = await harness.supabase
      .from('enrollments')
      .update({
        state: 'completed',
        current_node_id: email2NodeId,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', olderCompletedId);
    assert.equal(strandOlderError, null);

    const { error: parkTipError } = await harness.supabase
      .from('enrollments')
      .update({
        state: 'completed',
        current_node_id: midEmailNodeId,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tipCompletedId);
    assert.equal(parkTipError, null);

    const { data: campaignMid, error: campaignMidError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignMidError, null);

    const tipAppendedFlow = appendEmailAfterLeaf(
      campaignMid!.flow_data as CampaignFlowData,
      MID_FLOW_EMAIL_FLOW_NODE_ID,
      SECOND_APPEND_EMAIL_FLOW_NODE_ID,
    );
    const secondAppend = await updateCampaignFlowDataWithClient(harness.supabase, {
      campaignId: graph.campaignId,
      accountId: harness.env.accountId,
      flowData: tipAppendedFlow as unknown as Json,
      changeSource: 'append_older_leaf_test',
    });

    assert.equal(secondAppend.reactivated_count, 2);

    const olderAfter = await loadEnrollment(harness, olderCompletedId);
    const tipAfter = await loadEnrollment(harness, tipCompletedId);
    const stoppedAfter = await loadEnrollment(harness, olderStoppedId);

    assert.equal(olderAfter.state, 'active');
    assert.equal(olderAfter.current_node_id, email2NodeId);
    assert.ok(olderAfter.next_run_at);

    assert.equal(tipAfter.state, 'active');
    assert.equal(tipAfter.current_node_id, midEmailNodeId);
    assert.ok(tipAfter.next_run_at);

    assert.equal(stoppedAfter.state, 'stopped');
    assert.equal(stoppedAfter.current_node_id, email2NodeId);
    assert.equal(stoppedAfter.stopped_reason, 'replied');
  } finally {
    await harness.cleanup();
  }
});

test('content-only flow save reactivates completed enrollments stranded on non-leaf nodes', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('append-heal-content'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Heal On Content Save',
      status: 'paused',
      flowKind: 'emailWaitEmail',
      schedule: {
        timezone: 'UTC',
        start_hour: 0,
        start_minute: 0,
        end_hour: 23,
        end_minute: 59,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
      } as unknown as Json,
      leads: [
        buildCampaignLead({
          key: 'stranded',
          email: `stranded-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'completed',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'email-2-sent',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              sentAt: new Date(Date.now() - 60_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'stopped',
          email: `stopped-heal-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
            stoppedReason: 'bounced',
            stoppedAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const strandedId = graph.leadsByKey.get('stranded')!.enrollmentId!;
    const stoppedId = graph.leadsByKey.get('stopped')!.enrollmentId!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const { data: campaignBefore, error: campaignBeforeError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignBeforeError, null);

    const extendedFlow = appendEmailAfterLeaf(
      campaignBefore!.flow_data as CampaignFlowData,
      'email-2',
      MID_FLOW_EMAIL_FLOW_NODE_ID,
    );
    const setupSave = await updateCampaignFlowDataWithClient(harness.supabase, {
      campaignId: graph.campaignId,
      accountId: harness.env.accountId,
      flowData: extendedFlow as unknown as Json,
      changeSource: 'heal_content_setup',
    });
    assert.equal(setupSave.reactivated_count, 1);

    // Re-strand after the structural append so the next save is content-only.
    const { error: strandError } = await harness.supabase
      .from('enrollments')
      .update({
        state: 'completed',
        current_node_id: email2NodeId,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', strandedId);
    assert.equal(strandError, null);

    const { data: campaignExtended, error: campaignExtendedError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignExtendedError, null);

    const contentOnlyFlow = structuredClone(campaignExtended!.flow_data) as CampaignFlowData;
    const email2 = contentOnlyFlow.nodes.find((node) => node.id === 'email-2');
    assert.ok(email2);
    const email2Data = email2.data as { variants?: Array<{ subject?: string }> };
    assert.ok(email2Data.variants?.[0]);
    email2Data.variants[0].subject = 'Content-only heal subject';

    const healSave = await updateCampaignFlowDataWithClient(harness.supabase, {
      campaignId: graph.campaignId,
      accountId: harness.env.accountId,
      flowData: contentOnlyFlow as unknown as Json,
      changeSource: 'heal_content_test',
    });

    assert.equal(healSave.reactivated_count, 1);

    const strandedAfter = await loadEnrollment(harness, strandedId);
    const stoppedAfter = await loadEnrollment(harness, stoppedId);

    assert.equal(strandedAfter.state, 'active');
    assert.equal(strandedAfter.current_node_id, email2NodeId);
    assert.ok(strandedAfter.next_run_at);

    assert.equal(stoppedAfter.state, 'stopped');
    assert.equal(stoppedAfter.stopped_reason, 'bounced');
  } finally {
    await harness.cleanup();
  }
});
