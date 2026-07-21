import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { batchAssignIntervalJobs } from '../../../workers/scheduler-worker/src/batch-interval-assignment';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

/**
 * Outcome-first proof that the get_ready_interval_enrollments RPC + batchAssignIntervalJobs
 * path creates the same message_jobs as the prior enrollments SELECT +
 * get_existing_message_job_pairs round-trip. Asserts final job rows for this campaign only.
 */
test('batch interval assignment creates jobs only for eligible enrollments', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('batch-interval'),
  });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Batch Interval Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      sendingIntervalSeconds: 3600,
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `${harness.namespace}-m1@furnace.test`,
          displayName: 'Batch Interval Mailbox 1',
        },
        {
          key: 'mailbox-2',
          emailAddress: `${harness.namespace}-m2@furnace.test`,
          displayName: 'Batch Interval Mailbox 2',
        },
      ],
      leads: [
        // Eligible: due, no job, locked mailbox-1 -> should get a job
        buildCampaignLead({
          key: 'eligible-m1',
          email: `eligible-m1-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
        }),
        // Eligible: due, no job on email-2, unlocked mailbox, live reserved job on email-1/mailbox-2
        // -> should reuse live mailbox-2
        buildCampaignLead({
          key: 'live-mailbox',
          email: `live-${harness.namespace}@furnace.test`,
          mailboxKey: '',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-2',
            nextRunAt: new Date(now - 50_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'live-prior',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 30_000).toISOString(),
              scheduledAt: new Date(now - 20_000).toISOString(),
              mailboxKey: 'mailbox-2',
            }),
          ],
        }),
        // Blocking statuses for email-1: must NOT get another job
        buildCampaignLead({
          key: 'already-sent',
          email: `sent-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 40_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              sentAt: new Date(now - 10_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'already-failed',
          email: `failed-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 40_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'failed-1',
              nodeFlowNodeId: 'email-1',
              status: 'failed',
            }),
          ],
        }),
        buildCampaignLead({
          key: 'already-cancelled',
          email: `cancelled-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 40_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'cancelled-1',
              nodeFlowNodeId: 'email-1',
              status: 'cancelled',
            }),
          ],
        }),
        buildCampaignLead({
          key: 'already-blocked',
          email: `blocked-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 40_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'blocked-1',
              nodeFlowNodeId: 'email-1',
              status: 'blocked',
            }),
          ],
        }),
        // Future next_run_at: excluded
        buildCampaignLead({
          key: 'future',
          email: `future-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
        }),
        // Soft-deleted lead: excluded
        buildCampaignLead({
          key: 'deleted-lead',
          email: `deleted-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          deletedAt: new Date(now - 5_000).toISOString(),
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 30_000).toISOString(),
          }),
        }),
        // Priority email node: excluded from interval path
        buildCampaignLead({
          key: 'priority-node',
          email: `priority-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-3',
            nextRunAt: new Date(now - 30_000).toISOString(),
          }),
        }),
      ],
    });

    const intervalId = randomUUID();
    const intervalTime = new Date(now + 60 * 60_000).toISOString();
    const { error: intervalError } = await harness.supabase.from('campaign_intervals').insert({
      id: intervalId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      interval_time: intervalTime,
      status: 'available',
    } as any);
    assert.equal(intervalError, null, `interval insert failed: ${intervalError?.message}`);

    const eligibleM1 = graph.leadsByKey.get('eligible-m1')!;
    const liveMailbox = graph.leadsByKey.get('live-mailbox')!;
    const alreadySent = graph.leadsByKey.get('already-sent')!;
    const alreadyFailed = graph.leadsByKey.get('already-failed')!;
    const alreadyCancelled = graph.leadsByKey.get('already-cancelled')!;
    const alreadyBlocked = graph.leadsByKey.get('already-blocked')!;
    const future = graph.leadsByKey.get('future')!;
    const deletedLead = graph.leadsByKey.get('deleted-lead')!;
    const priorityNode = graph.leadsByKey.get('priority-node')!;

    // Soft-delete after insert: some lead-insert paths clear deleted_at on write.
    const { error: softDeleteError } = await harness.supabase
      .from('leads')
      .update({ deleted_at: new Date(now - 5_000).toISOString() } as any)
      .eq('id', deletedLead.leadId);
    assert.equal(softDeleteError, null, `soft-delete failed: ${softDeleteError?.message}`);

    const email1Id = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2Id = graph.nodeIdsByFlowNodeId.get('email-2')!;
    const email3Id = graph.nodeIdsByFlowNodeId.get('email-3')!;
    const mailbox1Id = graph.mailboxIdsByKey.get('mailbox-1')!;
    const mailbox2Id = graph.mailboxIdsByKey.get('mailbox-2')!;

    // Sanity: RPC itself returns only the two eligible enrollments in order.
    const { data: readyRows, error: readyError } = await harness.supabase.rpc(
      'get_ready_interval_enrollments',
      {
        p_campaign_id: graph.campaignId,
        p_node_ids: [email1Id, email2Id],
        p_now: new Date(now).toISOString(),
      },
    );
    assert.equal(readyError, null, `ready RPC failed: ${readyError?.message}`);
    const readyEnrollmentIds = ((readyRows ?? []) as Array<{ id: string }>).map((row) => row.id);
    assert.deepEqual(
      readyEnrollmentIds.sort(),
      [eligibleM1.enrollmentId!, liveMailbox.enrollmentId!].sort(),
      'RPC must return exactly the two eligible enrollments',
    );

    await batchAssignIntervalJobs(harness.supabase);

    const { data: jobs, error: jobsError } = await harness.supabase
      .from('message_jobs')
      .select('id, enrollment_id, node_id, mailbox_id, interval_id, status, message_type')
      .eq('campaign_id', graph.campaignId)
      .order('created_at', { ascending: true });
    assert.equal(jobsError, null, `jobs load failed: ${jobsError?.message}`);

    const jobsByEnrollment = new Map(
      ((jobs ?? []) as Array<{
        id: string;
        enrollment_id: string;
        node_id: string;
        mailbox_id: string;
        interval_id: string | null;
        status: string;
        message_type: string | null;
      }>).map((job) => [job.enrollment_id, job]),
    );

    // Seeded blocking jobs remain the only jobs for those enrollments.
    assert.equal(jobsByEnrollment.get(alreadySent.enrollmentId!)?.status, 'sent');
    assert.equal(jobsByEnrollment.get(alreadyFailed.enrollmentId!)?.status, 'failed');
    assert.equal(jobsByEnrollment.get(alreadyCancelled.enrollmentId!)?.status, 'cancelled');
    assert.equal(jobsByEnrollment.get(alreadyBlocked.enrollmentId!)?.status, 'blocked');

    // Newly created interval jobs for the two eligible enrollments.
    const eligibleJob = jobsByEnrollment.get(eligibleM1.enrollmentId!);
    assert.ok(eligibleJob, 'eligible locked-mailbox enrollment must receive a job');
    assert.equal(eligibleJob.node_id, email1Id);
    assert.equal(eligibleJob.mailbox_id, mailbox1Id);
    assert.equal(eligibleJob.interval_id, intervalId);
    assert.equal(eligibleJob.status, 'queued');

    const liveJob = (jobs ?? []).find(
      (job: any) =>
        job.enrollment_id === liveMailbox.enrollmentId &&
        job.node_id === email2Id,
    );
    assert.ok(liveJob, 'live-mailbox enrollment must receive an email-2 interval job');
    assert.equal(liveJob.mailbox_id, mailbox2Id);
    assert.equal(liveJob.interval_id, intervalId);
    assert.equal(liveJob.status, 'queued');

    // Exclusions: no jobs for future / deleted / priority-node enrollments.
    assert.equal(
      (jobs ?? []).filter((job: any) => job.enrollment_id === future.enrollmentId).length,
      0,
    );
    assert.equal(
      (jobs ?? []).filter((job: any) => job.enrollment_id === deletedLead.enrollmentId).length,
      0,
    );
    assert.equal(
      (jobs ?? []).filter((job: any) => job.enrollment_id === priorityNode.enrollmentId).length,
      0,
    );
    assert.equal(
      (jobs ?? []).filter((job: any) => job.node_id === email3Id).length,
      0,
      'priority email-3 must never be interval-assigned',
    );

    // Blocking enrollments must not have gained a second job.
    for (const leadKey of ['already-sent', 'already-failed', 'already-cancelled', 'already-blocked'] as const) {
      const enrollmentId = graph.leadsByKey.get(leadKey)!.enrollmentId!;
      const count = (jobs ?? []).filter((job: any) => job.enrollment_id === enrollmentId).length;
      assert.equal(count, 1, `${leadKey} must keep exactly its seeded blocking job`);
    }
  } finally {
    await harness.cleanup();
  }
});
