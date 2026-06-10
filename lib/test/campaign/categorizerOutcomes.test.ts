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
} from './categorizer-helpers';

/**
 * Full campaign-run scenarios for the categorizer node: scheduler -> jobs ->
 * simulated send -> inbound reply -> scheduler, asserting terminal row state
 * at each step. LLM calls are scripted (zero network).
 *
 * Flow under test (emailWaitEmailCategorizer):
 *   email-1 -> waitTime-1 -> email-2 -> categorizer
 *     interested      -> email-3 (send_mode 'reply')
 *     not-interested  -> email-4 (send_mode 'new')
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

test('happy path AI: reply mid-sequence holds outbound, classifies Interested, branches into an in-thread reply email', async () => {
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

    // --- Scheduler tick: classify + branch ---
    const scripted = createScriptedCategorizerTransport([
      { kind: 'classify', category: 'Interested' },
    ]);
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    assert.equal(scripted.calls.length, 1, 'exactly one LLM call for the classification');

    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Interested');
    assert.equal(thread.category_source, 'ai');

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

    // --- Scheduler tick: arm the in-thread reply email ---
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const jobs = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const replyJob = jobs.find((j) => j.message_type === 'campaign_reply');
    assert.ok(replyJob, 'reply-mode email must create a campaign_reply job');
    assert.equal(replyJob.status, 'queued');
    assert.equal(replyJob.interval_id, null, 'campaign_reply bypasses interval pacing');
    assert.equal(replyJob.node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
    assert.equal(replyJob.mailbox_id, thread.mailbox_id, 'reply must use the thread mailbox');
    assert.match(String(replyJob.message_data?.subject), /^Re: /);
    assert.ok(replyJob.message_data?.in_reply_to, 'In-Reply-To header stamped from the inbound reply');
    assert.equal(replyJob.message_data?.thread_id, threadId);

    // campaign_reply jobs ride the priority claim lane.
    const manualClaim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
      p_batch_size: 50,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(manualClaim.error, null);
    const claimedRows = (manualClaim.data ?? []) as any[];
    const claimedReply = claimedRows.find((row) => row.id === replyJob.id);
    assert.ok(claimedReply, 'claim_manual_message_jobs_ready must claim the campaign_reply job');
    // Release collateral claims from other dev campaigns.
    const collateral = claimedRows.filter((row) => row.id !== replyJob.id).map((row) => row.id);
    if (collateral.length > 0) {
      await harness.supabase
        .from('message_jobs')
        .update({ status: 'queued', status_reason: null, reserved_at: null, updated_at: new Date().toISOString() } as any)
        .in('id', collateral)
        .eq('status', 'reserved');
    }

    // --- Send worker: deliver the in-thread reply ---
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

    // --- Scheduler tick: Auto Reply -> restore at extracted return date ---
    // (system-stamped thread: one extraction call resolves the date)
    const scripted = createScriptedCategorizerTransport([
      { kind: 'classify', category: 'Auto Reply', returnDate },
    ]);
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    assert.equal(scripted.calls.length, 1, 'one extraction call for the return date');

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

    // --- Scheduler tick: classify the real reply and branch ---
    scripted.push({ kind: 'classify', category: 'Interested' });
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    assert.equal(scripted.calls.length, 2);

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

    const scripted = createScriptedCategorizerTransport([
      { kind: 'classify', category: 'Auto Reply', returnDate: null },
    ]);
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    assert.equal(scripted.calls.length, 1);

    const threadAfter = await getThreadRow(harness, threadId);
    assert.equal(threadAfter.category, 'Auto Reply');
    assert.equal(threadAfter.category_source, 'ai');

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
    const scripted = createScriptedCategorizerTransport([]);
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]);

    const parked = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(parked.state, 'active');
    assert.equal(parked.current_node_id, graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.equal(parked.next_run_at, null, 'no reply -> parked, zero polling cost');
    assert.equal(scripted.calls.length, 0, 'no reply -> no LLM call');

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

    scripted.push({ kind: 'classify', category: 'Interested' });
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
    const scripted = createScriptedCategorizerTransport([
      { kind: 'classify', category: 'Neutral' },
    ]);
    const scheduler = createTestSchedulerWorker(harness, { classifyTransport: scripted.transport });
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
