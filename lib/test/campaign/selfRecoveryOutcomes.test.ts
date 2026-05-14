import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlwaysOnSchedule, CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { maintainCampaignIntervals } from '../../../workers/scheduler-worker/src/interval-management';
import { batchAssignIntervalJobs } from '../../../workers/scheduler-worker/src/batch-interval-assignment';

/** Always-on schedule keeps interval seeding + batch assign independent of wall-clock vs Chicago business hours. */
const INTEGRATION_SCHEDULE = buildAlwaysOnSchedule();

function isReclaimRpcSchemaMismatch(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (!message.includes('reclaim_stale_campaign_message_jobs')) {
    return false;
  }
  const code = (error as { code?: string } | null)?.code;
  return (
    message.includes('p_reserved_stale_minutes') ||
    code === 'PGRST202' ||
    code === 'PGRST203'
  );
}

test('stale reserved campaign jobs are reclaimed to deferred transient_read_error and later recreated as fresh queued attempts', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('reclaim-reserved') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Reserved Reclaim Regression',
      status: 'running',
      flowKind: 'emailOnly',
      schedule: INTEGRATION_SCHEDULE as any,
      leads: [
        buildCampaignLead({
          key: 'reserved-reclaim',
          email: `reserved-reclaim-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 10 * 60_000).toISOString(),
              leaseExpiresAt: new Date(now - 5 * 60_000).toISOString(),
              claimToken: 'claim-token-1',
              scheduledAt: new Date(now - 20 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('reserved-reclaim')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;

    const reclaimResult = await harness.supabase
      .rpc('reclaim_stale_campaign_message_jobs', {
        p_batch_size: 50,
        p_rearm_delay_seconds: 60,
        p_reserved_stale_minutes: 5,
      });
    if (isReclaimRpcSchemaMismatch(reclaimResult.error)) {
      t.skip(
        'DB-backed test target has not applied reclaim_stale_campaign_message_jobs (3-arg) migration; refresh PostgREST schema after migrate',
      );
      return;
    }
    assert.equal(reclaimResult.error, null);
    assert.equal((reclaimResult.data ?? []).length, 1);

    const { data: reclaimedAttempt, error: reclaimedAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, reserved_at, lease_expires_at, claim_token, error_message')
      .eq('id', attemptId)
      .single();
    assert.equal(reclaimedAttemptError, null);
    assert.equal(reclaimedAttempt?.status, 'deferred');
    assert.equal(reclaimedAttempt?.status_reason, 'transient_read_error');
    assert.equal(reclaimedAttempt?.reserved_at, null);
    assert.equal(reclaimedAttempt?.lease_expires_at, null);
    assert.equal(reclaimedAttempt?.claim_token, null);
    assert.match(String(reclaimedAttempt?.error_message), /Reserved lease expired/);

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.state, 'active');
    assert.ok(enrollmentRow?.next_run_at);

    const { error: rearmError } = await harness.supabase
      .from('enrollments')
      .update({ next_run_at: new Date(Date.now() - 5 * 60_000).toISOString() } as any)
      .eq('id', lead.enrollmentId!);
    assert.equal(rearmError, null);

    await maintainCampaignIntervals(harness.supabase as any);
    await batchAssignIntervalJobs(harness.supabase as any, 0);

    const { data: attempts, error: attemptsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, created_at')
      .eq('enrollment_id', lead.enrollmentId!)
      .eq('node_id', graph.nodeIdsByFlowNodeId.get('email-1')!)
      .order('created_at', { ascending: true });
    assert.equal(attemptsError, null);
    assert.equal(attempts?.length, 2);
    assert.equal(attempts?.[0]?.status, 'deferred');
    const recreatedAttempt = attempts?.find((row: any) => row.id !== attemptId);
    assert.ok(recreatedAttempt);
    assert.equal(recreatedAttempt?.status, 'queued');
    assert.equal(recreatedAttempt?.status_reason, null);
  } finally {
    await harness.cleanup();
  }
});

test('legacy reserved campaign jobs without lease_expires_at are reclaimed using reserved_at age and later recreated as fresh queued attempts', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('reclaim-legacy-reserved') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Legacy Reserved Reclaim Regression',
      status: 'running',
      flowKind: 'emailOnly',
      schedule: INTEGRATION_SCHEDULE as any,
      leads: [
        buildCampaignLead({
          key: 'legacy-reserved-reclaim',
          email: `legacy-reserved-reclaim-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 10 * 60_000).toISOString(),
              leaseExpiresAt: null,
              claimToken: null,
              scheduledAt: new Date(now - 20 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('legacy-reserved-reclaim')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;

    const reclaimResult = await harness.supabase
      .rpc('reclaim_stale_campaign_message_jobs', {
        p_batch_size: 50,
        p_rearm_delay_seconds: 60,
        p_reserved_stale_minutes: 5,
      });
    if (isReclaimRpcSchemaMismatch(reclaimResult.error)) {
      t.skip(
        'DB-backed test target has not applied reclaim_stale_campaign_message_jobs (3-arg) migration; refresh PostgREST schema after migrate',
      );
      return;
    }
    assert.equal(reclaimResult.error, null);
    assert.equal((reclaimResult.data ?? []).length, 1);

    const { data: reclaimedAttempt, error: reclaimedAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, reserved_at, lease_expires_at, claim_token, error_message')
      .eq('id', attemptId)
      .single();
    assert.equal(reclaimedAttemptError, null);
    assert.equal(reclaimedAttempt?.status, 'deferred');
    assert.equal(reclaimedAttempt?.status_reason, 'transient_read_error');
    assert.equal(reclaimedAttempt?.reserved_at, null);
    assert.equal(reclaimedAttempt?.lease_expires_at, null);
    assert.equal(reclaimedAttempt?.claim_token, null);
    assert.match(String(reclaimedAttempt?.error_message), /Reserved lease expired/);

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.state, 'active');
    assert.ok(enrollmentRow?.next_run_at);

    const { error: rearmError } = await harness.supabase
      .from('enrollments')
      .update({ next_run_at: new Date(Date.now() - 5 * 60_000).toISOString() } as any)
      .eq('id', lead.enrollmentId!);
    assert.equal(rearmError, null);

    await maintainCampaignIntervals(harness.supabase as any);
    await batchAssignIntervalJobs(harness.supabase as any, 0);

    const { data: attempts, error: attemptsError } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, created_at')
      .eq('enrollment_id', lead.enrollmentId!)
      .eq('node_id', graph.nodeIdsByFlowNodeId.get('email-1')!)
      .order('created_at', { ascending: true });
    assert.equal(attemptsError, null);
    assert.equal(attempts?.length, 2);
    assert.equal(attempts?.[0]?.status, 'deferred');
    const recreatedAttempt = attempts?.find((row: any) => row.id !== attemptId);
    assert.ok(recreatedAttempt);
    assert.equal(recreatedAttempt?.status, 'queued');
    assert.equal(recreatedAttempt?.status_reason, null);
  } finally {
    await harness.cleanup();
  }
});

test('finalize_message_job_sent commits mailbox throttle usage only on successful send finalization', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('finalize-send') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Finalize Send Regression',
      status: 'running',
      flowKind: 'emailOnly',
      schedule: INTEGRATION_SCHEDULE as any,
      leads: [
        buildCampaignLead({
          key: 'send-finalize',
          email: `send-finalize-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 30_000).toISOString(),
              leaseExpiresAt: new Date(now + 5 * 60_000).toISOString(),
              claimToken: 'claim-token-2',
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('send-finalize')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const throttleCheck = await harness.supabase
      .rpc('check_mailbox_throttle_and_reserve', {
        p_message_job_id: attemptId,
      })
      .single();
    assert.equal(throttleCheck.error, null);
    assert.equal(throttleCheck.data?.success, true);

    const { data: throttleBeforeFinalize, error: throttleBeforeFinalizeError } = await harness.supabase
      .from('mailbox_throttles')
      .select('sent_count, last_sent_at')
      .eq('mailbox_id', mailboxId)
      .eq('date', new Date().toISOString().slice(0, 10))
      .single();
    assert.equal(throttleBeforeFinalizeError, null);
    assert.equal(throttleBeforeFinalize?.sent_count, 0);
    assert.equal(throttleBeforeFinalize?.last_sent_at, null);

    const { error: sendingError } = await harness.supabase
      .from('message_jobs')
      .update({
        status: 'sending',
        sending_started_at: new Date().toISOString(),
      } as any)
      .eq('id', attemptId)
      .eq('status', 'reserved');
    assert.equal(sendingError, null);

    const finalizeResult = await harness.supabase.rpc('finalize_message_job_sent', {
      p_message_job_id: attemptId,
      p_provider_message_id: 'provider-message-id-1',
    });
    assert.equal(finalizeResult.error, null);
    assert.equal(finalizeResult.data, true);

    const { data: finalizedAttempt, error: finalizedAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, provider_message_id, sent_at, lease_expires_at, claim_token')
      .eq('id', attemptId)
      .single();
    assert.equal(finalizedAttemptError, null);
    assert.equal(finalizedAttempt?.status, 'sent');
    assert.equal(finalizedAttempt?.status_reason, 'sent_successfully');
    assert.equal(finalizedAttempt?.provider_message_id, 'provider-message-id-1');
    assert.equal(finalizedAttempt?.lease_expires_at, null);
    assert.equal(finalizedAttempt?.claim_token, null);
    assert.ok(finalizedAttempt?.sent_at);

    const { data: throttleAfterFinalize, error: throttleAfterFinalizeError } = await harness.supabase
      .from('mailbox_throttles')
      .select('sent_count, last_sent_at')
      .eq('mailbox_id', mailboxId)
      .eq('date', new Date().toISOString().slice(0, 10))
      .single();
    assert.equal(throttleAfterFinalizeError, null);
    assert.equal(throttleAfterFinalize?.sent_count, 1);
    assert.ok(throttleAfterFinalize?.last_sent_at);
  } finally {
    await harness.cleanup();
  }
});

test('stale sending campaign jobs are terminalized as uncertain send state and stop the enrollment', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('stale-sending') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Stale Sending Regression',
      status: 'running',
      flowKind: 'emailOnly',
      schedule: INTEGRATION_SCHEDULE as any,
      leads: [
        buildCampaignLead({
          key: 'stale-sending',
          email: `stale-sending-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'sending',
              reservedAt: new Date(now - 35 * 60_000).toISOString(),
              sendingStartedAt: new Date(now - 31 * 60_000).toISOString(),
              leaseExpiresAt: new Date(now - 25 * 60_000).toISOString(),
              claimToken: 'claim-token-3',
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('stale-sending')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;

    const finalizeResult = await harness.supabase.rpc('finalize_stale_sending_campaign_message_jobs', {
      p_batch_size: 20,
      p_stale_minutes: 30,
    });
    assert.equal(finalizeResult.error, null);
    assert.equal((finalizeResult.data ?? []).length, 1);

    const { data: failedAttempt, error: failedAttemptError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason, error_message, claim_token, lease_expires_at')
      .eq('id', attemptId)
      .single();
    assert.equal(failedAttemptError, null);
    assert.equal(failedAttempt?.status, 'failed');
    assert.equal(failedAttempt?.status_reason, 'uncertain_send_state');
    assert.match(String(failedAttempt?.error_message), /uncertain/i);
    assert.equal(failedAttempt?.claim_token, null);
    assert.equal(failedAttempt?.lease_expires_at, null);

    const { data: enrollmentRow, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, stopped_reason, stopped_error_message, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollmentRow?.state, 'stopped');
    assert.equal(enrollmentRow?.stopped_reason, 'error');
    assert.match(String(enrollmentRow?.stopped_error_message), /uncertain/i);
    assert.equal(enrollmentRow?.next_run_at, null);
  } finally {
    await harness.cleanup();
  }
});
