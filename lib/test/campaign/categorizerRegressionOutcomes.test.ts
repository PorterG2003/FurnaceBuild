import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import {
  buildProcessedReply,
  getEnrollmentRow,
  getJobsForEnrollment,
  getMailboxRow,
} from './categorizer-helpers';

/**
 * Backward-compatibility gate for the categorizer feature: campaigns WITHOUT
 * a categorizer node must behave bit-identically to before, and the new
 * 'held' job status must be invisible to every status-enumerating RPC on the
 * existing hot paths.
 */

test('non-categorizer flow: reply still hard-stops the enrollment with no hold columns touched', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-regress-stop'),
  });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Regression Legacy Stop',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'replier',
          email: `replier-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig-${harness.namespace}-replier@furnace.test>`,
            }),
            buildCampaignJob({
              key: 'queued-2',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
              scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('replier')!;
    const sentJobId = lead.messageJobIdsByKey.get('sent-1')!;
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', sentJobId)
      .single();
    const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);

    const threadManager = new ThreadManager(harness.supabase as any);
    const handled = await threadManager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail: `replier-${harness.namespace}@furnace.test`,
        mailboxEmail: mailbox.email_address,
        inReplyTo: sentJob!.provider_message_id,
        bodyText: 'Sounds interesting, tell me more.',
      }),
    );
    assert.equal(handled, true);

    // Legacy hard stop, exactly as before the categorizer existed.
    const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollment.state, 'stopped');
    assert.equal(enrollment.stopped_reason, 'replied');
    assert.equal(enrollment.reply_thread_id, null);
    assert.equal(enrollment.held_node_id, null);
    assert.equal(enrollment.held_next_run_at, null);

    // No job was held: the remaining queued job is untouched (legacy behavior
    // leaves cancellation to the scheduler's enrollment-state checks).
    const jobs = await getJobsForEnrollment(harness, lead.enrollmentId!);
    const queuedJob = jobs.find((j) => j.id === lead.messageJobIdsByKey.get('queued-2'));
    assert.equal(queuedJob?.status, 'queued');
    assert.ok(jobs.every((j) => j.status !== 'held'));

    // Replied event + stats written via the same RPC as before.
    const { data: repliedEvents, error: eventsError } = await harness.supabase
      .from('events')
      .select('id, event_type')
      .eq('campaign_id', graph.campaignId)
      .eq('lead_id', lead.leadId)
      .eq('event_type', 'replied');
    assert.equal(eventsError, null);
    assert.equal(repliedEvents?.length, 1);

    // Thread has no category: real replies on legacy flows are never stamped.
    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('category, category_source, has_reply')
      .eq('campaign_id', graph.campaignId)
      .eq('lead_id', lead.leadId);
    assert.equal(threads?.length, 1);
    assert.equal(threads?.[0]?.has_reply, true);
    assert.equal(threads?.[0]?.category, null);
    assert.equal(threads?.[0]?.category_source, null);
  } finally {
    await harness.cleanup();
  }
});

test('non-categorizer flow: auto-reply stamps the thread Auto Reply but enrollment behavior is unchanged (stop)', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-regress-auto'),
  });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Regression Legacy Auto Reply',
      status: 'running',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'ooo-lead',
          email: `ooo-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'waitTime-1',
            nextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig-${harness.namespace}-ooo@furnace.test>`,
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('ooo-lead')!;
    const sentJobId = lead.messageJobIdsByKey.get('sent-1')!;
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', sentJobId)
      .single();
    const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);

    const threadManager = new ThreadManager(harness.supabase as any);
    const handled = await threadManager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail: `ooo-${harness.namespace}@furnace.test`,
        mailboxEmail: mailbox.email_address,
        inReplyTo: sentJob!.provider_message_id,
        subject: 'Out of Office',
        bodyText: 'I am out of the office until further notice.',
        autoReply: true,
      }),
    );
    assert.equal(handled, true);

    // New: thread is stamped Auto Reply by the header detector.
    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('category, category_source')
      .eq('campaign_id', graph.campaignId)
      .eq('lead_id', lead.leadId);
    assert.equal(threads?.length, 1);
    assert.equal(threads?.[0]?.category, 'Auto Reply');
    assert.equal(threads?.[0]?.category_source, 'system');

    // Unchanged: legacy flows still hard-stop on any reply, including auto-replies.
    const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollment.state, 'stopped');
    assert.equal(enrollment.stopped_reason, 'replied');
    assert.equal(enrollment.held_node_id, null);
  } finally {
    await harness.cleanup();
  }
});

test('held jobs are inert across claim, reclaim, pause/resume, and stats RPCs', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-regress-held'),
  });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Regression Held Inertness',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'held-lead',
          email: `held-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: null,
            heldNodeFlowNodeId: 'waitTime-1',
            heldNextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'held-job',
              nodeFlowNodeId: 'email-2',
              // Past scheduled_at: would be instantly claimable if any RPC
              // wrongly treated held as queued.
              status: 'held',
              statusReason: null,
              scheduledAt: new Date(now - 30 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('held-lead')!;
    const heldJobId = lead.messageJobIdsByKey.get('held-job')!;

    const assertStillHeld = async (label: string) => {
      const { data, error } = await harness.supabase
        .from('message_jobs')
        .select('status, status_reason')
        .eq('id', heldJobId)
        .single();
      assert.equal(error, null, label);
      assert.equal(data?.status, 'held', `${label}: expected job to remain held`);
      assert.equal(data?.status_reason, null, `${label}: held carries no status_reason`);
    };

    // Claim RPCs are global; immediately release any collateral rows claimed
    // from other dev campaigns back to queued.
    const releaseCollateral = async (rows: any[]) => {
      const collateralIds = rows.map((row: any) => row.id).filter((id: string) => id !== heldJobId);
      if (collateralIds.length === 0) return;
      await harness.supabase
        .from('message_jobs')
        .update({
          status: 'queued',
          status_reason: null,
          reserved_at: null,
          lease_expires_at: null,
          claim_token: null,
          updated_at: new Date().toISOString(),
        } as any)
        .in('id', collateralIds)
        .eq('status', 'reserved');
    };

    // 1. Campaign send claim loop.
    const campaignClaim = await harness.supabase.rpc('claim_message_jobs_ready', {
      p_batch_size: 200,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(campaignClaim.error, null);
    assert.ok(
      !(campaignClaim.data ?? []).some((row: any) => row.id === heldJobId),
      'claim_message_jobs_ready must not claim held jobs',
    );
    await releaseCollateral(campaignClaim.data ?? []);
    await assertStillHeld('after claim_message_jobs_ready');

    // 2. Manual/priority claim loop.
    const manualClaim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
      p_batch_size: 50,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(manualClaim.error, null);
    assert.ok(
      !(manualClaim.data ?? []).some((row: any) => row.id === heldJobId),
      'claim_manual_message_jobs_ready must not claim held jobs',
    );
    await releaseCollateral(manualClaim.data ?? []);
    await assertStillHeld('after claim_manual_message_jobs_ready');

    // 3. Stale-job reclaim (self-recovery).
    const reclaim = await harness.supabase.rpc('reclaim_stale_campaign_message_jobs', {
      p_batch_size: 200,
      p_rearm_delay_seconds: 60,
      p_reserved_stale_minutes: 5,
    });
    assert.equal(reclaim.error, null);
    assert.ok(
      !(reclaim.data ?? []).some((row: any) => row.id === heldJobId || row.job_id === heldJobId),
      'reclaim_stale_campaign_message_jobs must not touch held jobs',
    );
    await assertStillHeld('after reclaim_stale_campaign_message_jobs');

    // 4. Pause must not convert held to deferred (a resume would resurrect it
    //    behind the categorizer's back).
    const pause = await harness.supabase.rpc('pause_campaign_and_defer_jobs', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(pause.error, null);
    await assertStillHeld('after pause_campaign_and_defer_jobs');

    // 5. Resume must not resurrect held jobs to queued.
    const resume = await harness.supabase.rpc('resume_campaign_and_reschedule_jobs', {
      p_campaign_id: graph.campaignId,
      p_pause_reason: 'Campaign paused',
    });
    assert.equal(resume.error, null);
    await assertStillHeld('after resume_campaign_and_reschedule_jobs');

    // Resume also must not wake the parked enrollment (it has no due work).
    const enrollmentAfterResume = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollmentAfterResume.state, 'active');
    assert.equal(
      enrollmentAfterResume.held_node_id,
      graph.nodeIdsByFlowNodeId.get('waitTime-1'),
      'hold snapshot must survive pause/resume',
    );

    // 6. Stats reconcile runs clean with held jobs present and counts none of
    //    them as sent.
    const reconcile = await harness.supabase.rpc('reconcile_campaign_stats', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(reconcile.error, null);
    const { data: stats } = await harness.supabase
      .from('campaign_stats')
      .select('emails_sent')
      .eq('campaign_id', graph.campaignId)
      .maybeSingle();
    assert.equal(stats?.emails_sent ?? 0, 0);

    // 7. Campaign-wide cancel IS allowed to clear holds (terminal path).
    const cancel = await harness.supabase.rpc('cancel_unsent_campaign_jobs', {
      p_campaign_id: graph.campaignId,
      p_reason: 'Campaign stopped',
    });
    assert.equal(cancel.error, null);
    const { data: cancelled } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', heldJobId)
      .single();
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(cancelled?.status_reason, 'manually_cancelled');
    const enrollmentAfterCancel = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollmentAfterCancel.held_node_id, null, 'campaign cancel clears hold snapshots');
    assert.equal(enrollmentAfterCancel.held_next_run_at, null);
  } finally {
    await harness.cleanup();
  }
});

test('parked enrollments (next_run_at NULL) are invisible to claim_enrollments_ready', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-regress-park'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Regression Parked Claim',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      leads: [
        buildCampaignLead({
          key: 'parked',
          email: `parked-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: null,
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('parked')!;
    const claim = await harness.supabase.rpc('claim_enrollments_ready', {
      p_batch_size: 500,
    });
    assert.equal(claim.error, null);
    assert.ok(
      !(claim.data ?? []).some((row: any) => row.id === lead.enrollmentId),
      'claim_enrollments_ready must never see parked enrollments',
    );

    const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollment.state, 'active');
    assert.equal(enrollment.next_run_at, null);
  } finally {
    await harness.cleanup();
  }
});
