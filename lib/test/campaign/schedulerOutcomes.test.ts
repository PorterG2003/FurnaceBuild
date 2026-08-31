import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

test('seeded scheduler states distinguish running, future, stopped, and paused enrollment outcomes', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('scheduler-claim') });
  const now = Date.now();

  try {
    const runningGraph = await harness.createCampaignGraph({
      name: 'Scheduler Claim Running',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'claimable',
          email: `claimable-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: null,
            nextRunAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'future-active',
          email: `future-active-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: null,
            nextRunAt: new Date(now + 60 * 60 * 1000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'stopped',
          email: `stopped-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'stopped',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 5 * 60 * 1000).toISOString(),
            stoppedReason: 'replied',
            stoppedAt: new Date(now - 10 * 60 * 1000).toISOString(),
          }),
        }),
      ],
    });

    const pausedGraph = await harness.createCampaignGraph({
      name: 'Scheduler Claim Paused',
      status: 'paused',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'paused-claimable',
          email: `paused-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: null,
            nextRunAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
          }),
        }),
      ],
    });

    const scheduledGraph = await harness.createCampaignGraph({
      name: 'Scheduler Claim Scheduled',
      status: 'scheduled',
      flowKind: 'emailOnly',
      startDate: '2099-01-01',
      scheduleTimezone: 'America/Chicago',
      leads: [
        buildCampaignLead({
          key: 'scheduled-claimable',
          email: `scheduled-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: null,
            nextRunAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
          }),
        }),
      ],
    });

    const runningClaimable = runningGraph.leadsByKey.get('claimable')!.enrollmentId!;
    const runningFuture = runningGraph.leadsByKey.get('future-active')!.enrollmentId!;
    const runningStopped = runningGraph.leadsByKey.get('stopped')!.enrollmentId!;
    const pausedClaimable = pausedGraph.leadsByKey.get('paused-claimable')!.enrollmentId!;
    const scheduledClaimable = scheduledGraph.leadsByKey.get('scheduled-claimable')!.enrollmentId!;

    const { data: rows, error: rowsError } = await harness.supabase
      .from('enrollments')
      .select('id, campaign_id, state, next_run_at')
      .in('id', [runningClaimable, runningFuture, runningStopped, pausedClaimable, scheduledClaimable]);
    assert.equal(rowsError, null);
    const rowById = new Map((rows ?? []).map((row: any) => [row.id, row]));
    const { data: campaigns, error: campaignsError } = await harness.supabase
      .from('campaigns')
      .select('id, status')
      .in('id', [runningGraph.campaignId, pausedGraph.campaignId, scheduledGraph.campaignId]);
    assert.equal(campaignsError, null);
    const campaignStatusById = new Map((campaigns ?? []).map((row: any) => [row.id, row.status]));

    const runningClaimableRow = rowById.get(runningClaimable);
    const runningFutureRow = rowById.get(runningFuture);
    const runningStoppedRow = rowById.get(runningStopped);
    const pausedClaimableRow = rowById.get(pausedClaimable);

    assert.equal(runningClaimableRow?.state, 'active');
    assert.equal(campaignStatusById.get(runningClaimableRow?.campaign_id), 'running');
    assert.ok(runningClaimableRow?.next_run_at);

    assert.equal(runningFutureRow?.state, 'active');
    assert.equal(campaignStatusById.get(runningFutureRow?.campaign_id), 'running');
    assert.ok(Date.parse(runningFutureRow?.next_run_at ?? '') > now);

    assert.equal(runningStoppedRow?.state, 'stopped');
    assert.equal(campaignStatusById.get(runningStoppedRow?.campaign_id), 'running');

    assert.equal(pausedClaimableRow?.state, 'active');
    assert.equal(campaignStatusById.get(pausedClaimableRow?.campaign_id), 'paused');
    assert.ok(Date.parse(pausedClaimableRow?.next_run_at ?? '') <= now);

    const scheduledClaimableRow = rowById.get(scheduledClaimable);
    assert.equal(scheduledClaimableRow?.state, 'active');
    assert.equal(campaignStatusById.get(scheduledClaimableRow?.campaign_id), 'scheduled');
  } finally {
    await harness.cleanup();
  }
});
