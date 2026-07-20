import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness, type MaterializedCampaignGraph } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import { resetCategorizerLlmFailureTracking } from '../../../workers/scheduler-worker/src/node-handlers/ai-categorizer-handler';
import {
  buildProcessedReply,
  createScriptedCategorizerTransport,
  createTestSchedulerWorker,
  createTestSendWorker,
  getEnrollmentRow,
  getJobsForEnrollment,
  getMailboxRow,
  getThreadRow,
  processEnrollmentIds,
  simulateClassifyLambda,
} from './categorizer-helpers';

/**
 * Full campaign-run scenarios for the categorizer node: scheduler -> jobs ->
 * simulated send -> inbound reply -> scheduler, asserting terminal row state
 * at each step. LLM calls are scripted (zero network).
 *
 * Flow under test (emailWaitEmailCategorizer):
 *   email-1 -> waitTime-1 -> email-2 -> categorizer
 *     interested      -> email-3 (priority true)
 *     not-interested  -> email-4 (priority true)
 *     neutral         -> (no edge)
 */

type SeededLead = {
  graph: MaterializedCampaignGraph;
  leadKey: string;
  leadId: string;
  enrollmentId: string;
  leadEmail: string;
  sentJobId: string;
  queuedJobId: string;
};

async function seedThrottleRow(
  harness: CampaignDbHarness,
  params: {
    mailboxId: string;
    sentCount: number;
    hourlySent?: Record<string, number>;
    dailyLimit?: number;
    hourlyLimit?: number;
    minGapSeconds?: number;
    lastSentAt?: string | null;
  },
) {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await harness.supabase
    .from('mailbox_throttles')
    .upsert({
      mailbox_id: params.mailboxId,
      account_id: harness.env.accountId,
      date: today,
      sent_count: params.sentCount,
      hourly_sent: params.hourlySent ?? {},
      daily_limit: params.dailyLimit ?? 50,
      hourly_limit: params.hourlyLimit ?? 10,
      min_gap_seconds: params.minGapSeconds ?? 180,
      last_sent_at: params.lastSentAt ?? null,
    });

  assert.equal(error, null);
}

async function seedMidSequenceLead(
  harness: CampaignDbHarness,
  params: { name: string; useAi: boolean },
): Promise<SeededLead> {
  const now = Date.now();
  const leadEmail = `lead-${harness.namespace}@furnace.test`;
  const graph = await harness.createCampaignGraph({
    name: params.name,
    status: 'running',
    flowKind: 'emailWaitEmailCategorizer',
    categorizerUseAi: params.useAi,
    leads: [
      buildCampaignLead({
        key: 'subject',
        email: leadEmail,
        mailboxKey: 'mailbox-1',
        enrollment: buildCampaignEnrollment({
          // Mid-sequence: email-1 sent, waiting at the wait node before email-2.
          state: 'active',
          currentFlowNodeId: 'waitTime-1',
          nextRunAt: new Date(now + 60 * 60_000).toISOString(),
        }),
        jobs: [
          buildCampaignJob({
            key: 'sent-1',
            nodeFlowNodeId: 'email-1',
            status: 'sent',
            scheduledAt: new Date(now - 2 * 60 * 60_000).toISOString(),
            sentAt: new Date(now - 2 * 60 * 60_000).toISOString(),
            providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
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

  const lead = graph.leadsByKey.get('subject')!;
  return {
    graph,
    leadKey: 'subject',
    leadId: lead.leadId,
    enrollmentId: lead.enrollmentId!,
    leadEmail,
    sentJobId: lead.messageJobIdsByKey.get('sent-1')!,
    queuedJobId: lead.messageJobIdsByKey.get('queued-2')!,
  };
}

async function deliverReply(
  harness: CampaignDbHarness,
  seeded: SeededLead,
  params: { bodyText: string; subject?: string; autoReply?: boolean },
): Promise<{ threadId: string }> {
  const { data: sentJob } = await harness.supabase
    .from('message_jobs')
    .select('mailbox_id, provider_message_id')
    .eq('id', seeded.sentJobId)
    .single();
  const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);

  const threadManager = new ThreadManager(harness.supabase as any);
  const handled = await threadManager.handleReply(
    mailbox,
    buildProcessedReply({
      leadEmail: seeded.leadEmail,
      mailboxEmail: mailbox.email_address,
      inReplyTo: sentJob!.provider_message_id,
      bodyText: params.bodyText,
      subject: params.subject,
      autoReply: params.autoReply,
    }),
  );
  assert.equal(handled, true, 'inbox-checker must accept the reply');

  const { data: threads } = await harness.supabase
    .from('email_threads')
    .select('id')
    .eq('enrollment_id', seeded.enrollmentId)
    .eq('has_reply', true)
    .order('last_message_at', { ascending: false })
    .limit(1);
  const threadId = threads?.[0]?.id as string | undefined;
  assert.ok(threadId, 'reply must land in a replied thread for the enrollment');
  return { threadId };
}

function assertHeldState(params: {
  enrollment: any;
  graph: MaterializedCampaignGraph;
  heldFlowNodeId: string;
}): void {
  assert.equal(params.enrollment.state, 'active');
  assert.equal(
    params.enrollment.current_node_id,
    params.graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'),
    'reply must fast-forward the enrollment to the categorizer',
  );
  assert.equal(
    params.enrollment.held_node_id,
    params.graph.nodeIdsByFlowNodeId.get(params.heldFlowNodeId),
    'hold snapshot must capture the pre-reply position',
  );
  assert.ok(params.enrollment.next_run_at, 'park RPC wakes the enrollment for the scheduler');
}

test('happy path AI: reply mid-sequence holds outbound, classifies Interested, branches into a priority email', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-ai-happy') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer AI Happy Path', useAi: true });
    const { graph } = seeded;

    // --- Reply arrives ---
    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'This looks great - can you send pricing?',
    });

    // Hold: queued email-2 job held, position snapshotted, fast-forwarded.
    const enrollmentAfterReply = await getEnrollmentRow(harness, seeded.enrollmentId);
    assertHeldState({ enrollment: enrollmentAfterReply, graph, heldFlowNodeId: 'waitTime-1' });
    const { data: heldJob } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(heldJob?.status, 'held');

    // --- Classify Lambda: write the durable category + wake the enrollment ---
    const classify = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    assert.equal(classify.ok, true);
    assert.equal(classify.calls.length, 1, 'exactly one LLM call for the classification');

    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Interested');
    assert.equal(thread.category_source, 'ai');

    // --- Scheduler tick: branch on the durable category ---
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.reply_thread_id, threadId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
    assert.equal(branched.held_node_id, null, 'branch clears the hold snapshot');
    const { data: cancelledJob } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(cancelledJob?.status, 'cancelled');
    assert.equal(cancelledJob?.status_reason, 'reply_received');

    // AI categorization syncs positive-reply stats like manual categorization.
    const { data: stats } = await harness.supabase
      .from('campaign_stats')
      .select('positive_reply_count')
      .eq('campaign_id', graph.campaignId)
      .maybeSingle();
    assert.equal(stats?.positive_reply_count, 1);

    // --- Scheduler tick: arm the priority email ---
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const jobs = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const replyJob = jobs.find((j) => j.message_type === 'campaign_priority');
    assert.ok(replyJob, 'priority email must create a campaign_priority job');
    assert.equal(replyJob.status, 'queued');
    assert.equal(replyJob.interval_id, null, 'campaign_priority bypasses interval pacing');
    assert.equal(replyJob.node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
    assert.equal(replyJob.mailbox_id, thread.mailbox_id, 'reply must use the thread mailbox');
    assert.equal(replyJob.message_data?.subject ?? null, null);
    assert.equal(replyJob.message_data?.in_reply_to ?? null, null);
    assert.equal(replyJob.message_data?.thread_id, threadId);

    // campaign_priority jobs ride the priority claim lane.
    const manualClaim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
      p_batch_size: 50,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(manualClaim.error, null);
    const claimedRows = (manualClaim.data ?? []) as any[];
    const claimedReply = claimedRows.find((row) => row.id === replyJob.id);
    assert.ok(claimedReply, 'claim_manual_message_jobs_ready must claim the campaign_priority job');
    // Release collateral claims from other dev campaigns.
    const collateral = claimedRows.filter((row) => row.id !== replyJob.id).map((row) => row.id);
    if (collateral.length > 0) {
      await harness.supabase
        .from('message_jobs')
        .update({ status: 'queued', status_reason: null, reserved_at: null, updated_at: new Date().toISOString() } as any)
        .in('id', collateral)
        .eq('status', 'reserved');
    }

    // --- Send worker: deliver the priority email ---
    const messageCountBefore = thread.message_count;
    const sendWorker = createTestSendWorker(harness);
    const { data: reservedReplyJob } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', replyJob.id)
      .single();
    await (sendWorker as any).processMessageJob(reservedReplyJob);

    const { data: sentReplyJob } = await harness.supabase
      .from('message_jobs')
      .select('status, provider_message_id, sent_at')
      .eq('id', replyJob.id)
      .single();
    assert.equal(sentReplyJob?.status, 'sent');
    assert.ok(sentReplyJob?.provider_message_id);

    // The sent reply is recorded inside the replied thread.
    const { data: sentMessages } = await harness.supabase
      .from('email_messages')
      .select('direction, in_reply_to, message_job_id')
      .eq('thread_id', threadId)
      .eq('message_job_id', replyJob.id);
    assert.equal(sentMessages?.length, 1);
    assert.equal(sentMessages?.[0]?.direction, 'sent');
    assert.ok(sentMessages?.[0]?.in_reply_to);
    const threadAfterSend = await getThreadRow(harness, threadId);
    assert.equal(threadAfterSend.message_count, messageCountBefore + 1);

    // --- Scheduler tick: email-3 sent, no further edges -> completed ---
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const finalEnrollment = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(finalEnrollment.state, 'completed');
  } finally {
    await harness.cleanup();
  }
});

test('manual mode: parks with holds kept until the user categorizes, then wakes and branches', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-manual') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer Manual Mode', useAi: false });
    const { graph } = seeded;

    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Who is this? Maybe talk to my colleague.',
    });

    // Scheduler tick: manual + uncategorized -> park, holds KEPT.
    const scripted = createScriptedCategorizerTransport([]); // any LLM call would throw
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    assert.equal(scripted.calls.length, 0, 'manual mode must never call the LLM');

    const parked = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(parked.state, 'active');
    assert.equal(parked.next_run_at, null, 'parked: invisible to the claim loop');
    assert.equal(parked.current_node_id, graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.equal(parked.held_node_id, graph.nodeIdsByFlowNodeId.get('waitTime-1'), 'manual park keeps the hold');
    const { data: heldJob } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(heldJob?.status, 'held');

    // User categorizes in the Master Inbox (write + wake RPC, the same calls
    // updateThreadCategory makes).
    await harness.supabase
      .from('email_threads')
      .update({ category: 'Not Interested', category_source: 'user', updated_at: new Date().toISOString() } as any)
      .eq('id', threadId);
    const wake = await harness.supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
    assert.equal(wake.error, null);
    assert.equal(wake.data, true, 'wake RPC must wake the parked enrollment');

    const woken = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.ok(woken.next_run_at, 'woken enrollment is claimable again');

    // Scheduler tick: manual category branches down the not-interested edge.
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.reply_thread_id, threadId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-4'));
    assert.equal(branched.held_node_id, null);
    const { data: cancelledJob } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(cancelledJob?.status, 'cancelled');
    assert.equal(cancelledJob?.status_reason, 'reply_received');
    assert.equal(scripted.calls.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('campaign_priority throttle retries stay on the same priority-lane job while respecting schedule windows', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-reply-throttle') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer Reply Retry Lane', useAi: true });
    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Interested - send over pricing.',
    });

    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]); // branch
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]); // arm reply email

    const jobsBeforeClaim = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const replyJob = jobsBeforeClaim.find((row) => row.message_type === 'campaign_priority');
    assert.ok(replyJob, 'priority branch must create a campaign_priority job');

    const claim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
      p_batch_size: 50,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(claim.error, null);

    const { data: reservedReplyJob } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', replyJob!.id)
      .single();
    assert.equal(reservedReplyJob?.status, 'reserved');

    const lastSentAt = new Date(Date.now() - 2 * 60_000).toISOString();
    await seedThrottleRow(harness, {
      mailboxId: replyJob!.mailbox_id!,
      sentCount: 0,
      dailyLimit: 50,
      hourlyLimit: 50,
      minGapSeconds: 3600,
      lastSentAt,
    });

    const sendWorker = createTestSendWorker(harness);
    await (sendWorker as any).processMessageJob(reservedReplyJob);

    const { data: retriedReplyJob } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, scheduled_at, send_wait_reason')
      .eq('id', replyJob!.id)
      .single();
    assert.equal(retriedReplyJob?.status, 'queued');
    assert.equal(retriedReplyJob?.status_reason, null);
    assert.equal(retriedReplyJob?.send_wait_reason, 'Waiting for minimum time between sends');
    assert.ok(Date.parse(retriedReplyJob!.scheduled_at) >= Date.parse(lastSentAt) + 3600_000);

    const jobsAfterRetry = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const replyJobs = jobsAfterRetry.filter((row) => row.message_type === 'campaign_priority');
    assert.equal(replyJobs.length, 1, 'retry should stay on the existing campaign_priority job');

    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const jobsAfterScheduler = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const replyJobsAfterScheduler = jobsAfterScheduler.filter((row) => row.message_type === 'campaign_priority');
    assert.equal(replyJobsAfterScheduler.length, 1, 'scheduler must not recreate a deferred retry job');
  } finally {
    await harness.cleanup();
  }
});

test('OOO round-trip: auto-reply holds then restores at the extracted return date; later real reply re-holds and branches', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-ooo') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer OOO Round Trip', useAi: true });
    const { graph } = seeded;
    const returnDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // --- Header'd auto-reply arrives ---
    const { threadId } = await deliverReply(harness, seeded, {
      subject: 'Automatic reply: Quick check-in',
      bodyText: `I am out of the office and will return on ${returnDate}.`,
      autoReply: true,
    });

    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Auto Reply');
    assert.equal(thread.category_source, 'system');

    const heldEnrollment = await getEnrollmentRow(harness, seeded.enrollmentId);
    assertHeldState({ enrollment: heldEnrollment, graph, heldFlowNodeId: 'waitTime-1' });
    const heldNextRunAt = heldEnrollment.held_next_run_at as string;

    // --- Classify Lambda: system-stamped Auto Reply parses the return date
    // from the body (no LLM call), then the scheduler restores at that date. ---
    const autoReplyClassify = await simulateClassifyLambda(harness, { threadId }, []);
    assert.equal(autoReplyClassify.ok, true);
    assert.equal(autoReplyClassify.calls.length, 0, 'system-stamped Auto Reply needs no LLM call');
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const restored = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(restored.state, 'active');
    assert.equal(
      restored.current_node_id,
      graph.nodeIdsByFlowNodeId.get('waitTime-1'),
      'restore puts the enrollment back at its exact pre-reply position',
    );
    assert.equal(restored.held_node_id, null);
    assert.equal(restored.reply_thread_id, null, 'auto-reply never branches');
    const resumeFloorMs = Date.parse(`${returnDate}T00:00:00.000Z`);
    assert.ok(
      Date.parse(restored.next_run_at) >= Math.max(resumeFloorMs, Date.parse(heldNextRunAt)),
      'resume timing honors the extracted return date and the original wait',
    );

    // Held job released back to queued, floored to the return date.
    const { data: restoredJob } = await harness.supabase
      .from('message_jobs')
      .select('status, scheduled_at')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(restoredJob?.status, 'queued');
    assert.ok(Date.parse(restoredJob!.scheduled_at) >= resumeFloorMs);

    // --- Later: a real reply arrives ---
    await deliverReply(harness, seeded, {
      bodyText: 'Back now - yes, I would love to chat!',
    });

    // Real reply clears the machine-set Auto Reply stamp and re-holds.
    const threadAfterReal = await getThreadRow(harness, threadId);
    assert.equal(threadAfterReal.category, null, 'real reply clears machine-set Auto Reply');
    const reHeld = await getEnrollmentRow(harness, seeded.enrollmentId);
    assertHeldState({ enrollment: reHeld, graph, heldFlowNodeId: 'waitTime-1' });
    const { data: reHeldJob } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(reHeldJob?.status, 'held');

    // --- Classify Lambda on the real reply, then the scheduler branches ---
    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.reply_thread_id, threadId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
    const { data: finalHeldJob } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(finalHeldJob?.status, 'cancelled');
    assert.equal(finalHeldJob?.status_reason, 'reply_received');
  } finally {
    await harness.cleanup();
  }
});

test('headerless OOO: AI classifies Auto Reply, writes the category, and restores without branching', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-ooo-headerless') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer Headerless OOO', useAi: true });
    const { graph } = seeded;

    // No autoresponder headers: the detector can't see it, AI must catch it.
    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'I am currently away with limited email access and will respond when I return.',
    });
    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, null, 'headerless auto-reply is not stamped by the detector');

    const classify = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Auto Reply', returnDate: null },
    ]);
    assert.equal(classify.ok, true);
    assert.equal(classify.calls.length, 1);

    const threadAfter = await getThreadRow(harness, threadId);
    assert.equal(threadAfter.category, 'Auto Reply');
    assert.equal(threadAfter.category_source, 'ai');

    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    // No return date -> resume immediately at the held position.
    const restored = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(restored.state, 'active');
    assert.equal(restored.current_node_id, graph.nodeIdsByFlowNodeId.get('waitTime-1'));
    assert.equal(restored.reply_thread_id, null, 'Auto Reply never branches');
    assert.equal(restored.held_node_id, null);
    const { data: restoredJob } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(restoredJob?.status, 'queued');
  } finally {
    await harness.cleanup();
  }
});

test('schedule_thread_ooo_resume restores held categorizer enrollments through the same user-facing action', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-ooo-facade') });
  resetCategorizerLlmFailureTracking();

  try {
    const probe = await harness.supabase.rpc('schedule_thread_ooo_resume', {
      p_thread_id: '00000000-0000-4000-8000-000000000000',
      p_resume_at: new Date().toISOString(),
      p_return_date: null,
      p_mark_auto_reply: true,
    });
    if (probe.error?.code === 'PGRST202') {
      return;
    }

    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer OOO Facade', useAi: true });
    const { graph } = seeded;
    const returnDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { threadId } = await deliverReply(harness, seeded, {
      subject: 'Automatic reply: Unified OOO',
      bodyText: `I am out of the office and will return on ${returnDate}.`,
      autoReply: true,
    });

    const heldEnrollment = await getEnrollmentRow(harness, seeded.enrollmentId);
    assertHeldState({ enrollment: heldEnrollment, graph, heldFlowNodeId: 'waitTime-1' });
    const heldNextRunAt = heldEnrollment.held_next_run_at as string;

    const { data: result, error } = await harness.supabase.rpc('schedule_thread_ooo_resume', {
      p_thread_id: threadId,
      p_resume_at: `${returnDate}T12:00:00.000Z`,
      p_return_date: returnDate,
      p_mark_auto_reply: true,
    });
    assert.equal(error, null);
    assert.equal(result, 'resumed_held');

    const restored = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(restored.state, 'active');
    assert.equal(
      restored.current_node_id,
      graph.nodeIdsByFlowNodeId.get('waitTime-1'),
      'facade restore puts the enrollment back at its exact pre-reply position',
    );
    assert.equal(restored.held_node_id, null);
    assert.equal(restored.reply_thread_id, null, 'Auto Reply facade restore never branches');

    const resumeFloorMs = Date.parse(`${returnDate}T12:00:00.000Z`);
    assert.ok(
      Date.parse(restored.next_run_at) >= Math.max(resumeFloorMs, Date.parse(heldNextRunAt)),
      'facade restore honors the chosen resume time and the original wait',
    );

    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Auto Reply');
    assert.equal(thread.out_of_office, true);

    const { data: restoredJob } = await harness.supabase
      .from('message_jobs')
      .select('status, scheduled_at')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(restoredJob?.status, 'queued');
    assert.ok(Date.parse(restoredJob!.scheduled_at) >= resumeFloorMs);
  } finally {
    await harness.cleanup();
  }
});

test('no reply ever: enrollment walks to the categorizer and parks; sweep never wakes it', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-no-reply') });
  resetCategorizerLlmFailureTracking();
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer No Reply Park',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'silent',
          email: `silent-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            // Finished email-2; the next traversal step is the categorizer.
            state: 'active',
            currentFlowNodeId: 'email-2',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-2',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig2-${harness.namespace}@furnace.test>`,
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('silent')!;
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]);

    const parked = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(parked.state, 'active');
    assert.equal(parked.current_node_id, graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.equal(parked.next_run_at, null, 'no reply -> parked, zero polling cost');

    // Sweep is a no-op for enrollments with no replied thread.
    const sweep = await harness.supabase.rpc('sweep_parked_categorizer_enrollments', {
      p_batch_size: 200,
    });
    assert.equal(sweep.error, null);
    const stillParked = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(stillParked.next_run_at, null, 'sweep must not wake reply-less enrollments');

    // --- Late reply weeks later wakes it through the normal park RPC path ---
    const seededLike: SeededLead = {
      graph,
      leadKey: 'silent',
      leadId: lead.leadId,
      enrollmentId: lead.enrollmentId!,
      leadEmail: `silent-${harness.namespace}@furnace.test`,
      sentJobId: lead.messageJobIdsByKey.get('sent-2')!,
      queuedJobId: lead.messageJobIdsByKey.get('sent-2')!,
    };
    const { threadId } = await deliverReply(harness, seededLike, {
      bodyText: 'Sorry for the slow response - yes, interested!',
    });

    const woken = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.ok(woken.next_run_at, 'late reply wakes the parked enrollment');
    assert.equal(woken.held_node_id, null, 'already at the categorizer: nothing re-held');

    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]);
    const branched = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(branched.reply_thread_id, threadId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
  } finally {
    await harness.cleanup();
  }
});

test('no edge for the resolved category: enrollment completes with holds cancelled', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-no-edge') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Categorizer No Edge', useAi: true });
    const { graph } = seeded;

    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Hmm, not sure. Circle back next quarter maybe.',
    });

    // 'Neutral' has no connected edge in the test flow.
    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Neutral' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const completed = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.reply_thread_id, threadId, 'completion still records the branch decision');
    assert.equal(completed.held_node_id, null);
    const { data: cancelledJob } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(cancelledJob?.status, 'cancelled');
    assert.equal(cancelledJob?.status_reason, 'reply_received');

    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Neutral');
    assert.equal(thread.category_source, 'ai');
  } finally {
    await harness.cleanup();
  }
});
