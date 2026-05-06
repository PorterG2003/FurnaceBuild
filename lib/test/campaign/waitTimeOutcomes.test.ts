import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWaitTimeNode } from '../../../workers/scheduler-worker/src/node-handlers/wait-time-handler';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

test('wait-time handling updates a real enrollment row to the expected next_run_at outcome', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('wait-time') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Wait Time Outcome',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'wait-lead',
          email: `wait-${harness.namespace}@furnace.test`,
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
      } as any,
      {
        id: graph.nodeIdsByFlowNodeId.get('waitTime-1')!,
        node_data: { wait_duration_seconds: 1800 },
      },
      null,
      1,
      harness.supabase as any,
    );

    const enrollmentAfter = await harness.supabase
      .from('enrollments')
      .select('current_node_id, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentAfter.error, null);
    assert.equal(enrollmentAfter.data?.current_node_id, graph.nodeIdsByFlowNodeId.get('waitTime-1'));
    assert.equal(
      Date.parse(enrollmentAfter.data?.next_run_at ?? ''),
      Date.parse(new Date(Date.parse(enrollmentBefore.data!.updated_at) + 30 * 60 * 1000).toISOString()),
    );
  } finally {
    await harness.cleanup();
  }
});
