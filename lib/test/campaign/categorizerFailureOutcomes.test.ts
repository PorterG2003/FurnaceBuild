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
import { resetPriorityEmailWarningTracking } from '../../../workers/scheduler-worker/src/node-handlers/priority-email-handler';
import {
  buildProcessedReply,
  createTestSchedulerWorker,
  getEnrollmentRow,
  getMailboxRow,
  getThreadRow,
  processEnrollmentIds,
  simulateClassifyLambda,
} from './categorizer-helpers';

/**
 * Failure-mode matrix for the categorizer: every defined fallback proven
 * against real rows, not assumed. LLM failures, reply races, mailbox
 * hazards, terminal-path hold hygiene, and duplicate-send guards.
 */

const CHICAGO_SCHEDULE = {
  timezone: 'America/Chicago',
  start_hour: 9,
  start_minute: 0,
  end_hour: 17,
  end_minute: 0,
  days_of_week: [1, 2, 3, 4, 5],
} as const;

type Seeded = {
  graph: MaterializedCampaignGraph;
  leadId: string;
  enrollmentId: string;
  leadEmail: string;
  sentJobId: string;
  queuedJobId: string;
};

async function seedMidSequence(
  harness: CampaignDbHarness,
  params: { name: string; useAi: boolean; schedule?: unknown },
): Promise<Seeded> {
  const now = Date.now();
  const leadEmail = `lead-${harness.namespace}@furnace.test`;
  const graph = await harness.createCampaignGraph({
    name: params.name,
    status: 'running',
    flowKind: 'emailWaitEmailCategorizer',
    categorizerUseAi: params.useAi,
    ...(params.schedule ? { schedule: params.schedule as any } : {}),
    leads: [
      buildCampaignLead({
        key: 'subject',
        email: leadEmail,
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
    leadId: lead.leadId,
    enrollmentId: lead.enrollmentId!,
    leadEmail,
    sentJobId: lead.messageJobIdsByKey.get('sent-1')!,
    queuedJobId: lead.messageJobIdsByKey.get('queued-2')!,
  };
}

async function deliverReply(
  harness: CampaignDbHarness,
  seeded: Seeded,
  params: { bodyText: string; subject?: string; autoReply?: boolean; isUnsubscribe?: boolean },
): Promise<void> {
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
    params.isUnsubscribe ? { isUnsubscribe: true } : undefined,
  );
  assert.equal(handled, true);
}

async function latestThreadId(harness: CampaignDbHarness, enrollmentId: string): Promise<string> {
  const { data } = await harness.supabase
    .from('email_threads')
    .select('id')
    .eq('enrollment_id', enrollmentId)
    .eq('has_reply', true)
    .order('last_message_at', { ascending: false })
    .limit(1);
  const id = data?.[0]?.id as string | undefined;
  assert.ok(id);
  return id;
}

test('LLM classify failures (5xx, garbage JSON, transport throw) mark the thread failed and keep the enrollment parked with the hold intact; a later successful classify branches', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-llm') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequence(harness, { name: 'Categorizer LLM Failures', useAi: true });
    await deliverReply(harness, seeded, { bodyText: 'Yes, very interested!' });
    const threadId = await latestThreadId(harness, seeded.enrollmentId);

    const scheduler = createTestSchedulerWorker(harness);

    // Classification is consumer-only in the scheduler now: every classify
    // failure mode happens in the classify Lambda, which marks the thread
    // classification_status='failed' and writes no category. The scheduler then
    // parks (no branch), keeping the outbound hold intact until a successful
    // classify wakes it.
    const failureModes = [
      { kind: 'fail', details: 'upstream 500', httpStatus: 500 },
      { kind: 'garbage', text: 'I think this reply is interested, hope that helps!' },
      { kind: 'throw', message: 'socket timeout' },
    ] as const;

    for (const step of failureModes) {
      const classify = await simulateClassifyLambda(harness, { threadId }, [step]);
      assert.equal(classify.ok, false, `${step.kind}: classify Lambda reports failure`);

      const failedThread = await getThreadRow(harness, threadId);
      assert.equal(failedThread.category, null, `${step.kind}: no category write on failure`);
      assert.equal(failedThread.classification_status, 'failed', `${step.kind}: thread marked failed`);

      await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
      const enrollment = await getEnrollmentRow(harness, seeded.enrollmentId);
      assert.equal(enrollment.state, 'active', `${step.kind}: still active`);
      assert.equal(enrollment.reply_thread_id, null, `${step.kind}: no branch on failure`);
      assert.equal(
        enrollment.current_node_id,
        seeded.graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'),
        `${step.kind}: stays at the categorizer`,
      );
      assert.equal(
        enrollment.next_run_at,
        null,
        `${step.kind}: parked, waiting for the classifier (zero polling cost)`,
      );

      // Hold stays intact through failures - the outbound sequence must not leak.
      const { data: heldJob } = await harness.supabase
        .from('message_jobs')
        .select('status')
        .eq('id', seeded.queuedJobId)
        .single();
      assert.equal(heldJob?.status, 'held', `${step.kind}: hold intact`);
    }

    // A later successful classify writes the category, wakes, and branches.
    const recovered = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    assert.equal(recovered.ok, true);
    const thread = await getThreadRow(harness, threadId);
    assert.equal(thread.category, 'Interested');
    assert.equal(thread.classification_status, 'complete');

    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.reply_thread_id, threadId);
    assert.equal(branched.current_node_id, seeded.graph.nodeIdsByFlowNodeId.get('email-3'));
  } finally {
    await harness.cleanup();
  }
});

test('absurd model return date (in the past) is discarded end-to-end: Auto Reply resumes immediately', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-date') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequence(harness, { name: 'Categorizer Absurd Return Date', useAi: true });
    await deliverReply(harness, seeded, {
      bodyText: 'Out of office. Back on January 1st 2020.',
    });
    const threadId = await latestThreadId(harness, seeded.enrollmentId);

    const before = Date.now();
    // Past date: the parse-time sanitizer in the classify Lambda must discard it.
    await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Auto Reply', returnDate: '2020-01-01' },
    ]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const restored = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(restored.state, 'active');
    assert.equal(
      restored.current_node_id,
      seeded.graph.nodeIdsByFlowNodeId.get('waitTime-1'),
      'restored to the held position',
    );
    // Resume floor collapses to NOW (not 2020, not +90d).
    const nextRunMs = Date.parse(restored.next_run_at);
    assert.ok(nextRunMs <= before + 2 * 60 * 60_000 + 60_000, 'resume timing is NOW-based, not the absurd date');
    const { data: job } = await harness.supabase
      .from('message_jobs')
      .select('status, scheduled_at')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(job?.status, 'queued');
    assert.ok(Date.parse(job!.scheduled_at) <= before + 3 * 60 * 60_000, 'job not pushed into the far future');
  } finally {
    await harness.cleanup();
  }
});

test('reply race: a reserved (in-flight) job is never held; the enrollment still fast-forwards', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-race') });
  const now = Date.now();

  try {
    const seeded = await seedMidSequence(harness, { name: 'Categorizer Reserved Race', useAi: true });
    // Simulate the send worker holding the email-2 job mid-send.
    await harness.supabase
      .from('message_jobs')
      .update({ status: 'reserved', reserved_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() } as any)
      .eq('id', seeded.queuedJobId);

    await deliverReply(harness, seeded, { bodyText: 'Quick question before you send more...' });

    const { data: job } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', seeded.queuedJobId)
      .single();
    assert.equal(job?.status, 'reserved', 'in-flight jobs are never held (cannot stop a send mid-flight)');

    const enrollment = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(enrollment.current_node_id, seeded.graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.ok(enrollment.held_node_id, 'position still snapshotted for restore');
  } finally {
    await harness.cleanup();
  }
});

test('park RPC is idempotent: double delivery never re-snapshots, replies after branch never stop the enrollment', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-idem') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequence(harness, { name: 'Categorizer Park Idempotency', useAi: true });
    await deliverReply(harness, seeded, { bodyText: 'Reply one.' });
    const threadId = await latestThreadId(harness, seeded.enrollmentId);

    const firstHold = await getEnrollmentRow(harness, seeded.enrollmentId);
    const snapshotNode = firstHold.held_node_id;
    const snapshotNextRun = firstHold.held_next_run_at;
    assert.ok(snapshotNode);

    // Double delivery of the park event: 'woken', snapshot untouched.
    const second = await harness.supabase.rpc('park_or_advance_enrollment_on_reply', {
      p_enrollment_id: seeded.enrollmentId,
      p_thread_id: threadId,
    });
    assert.equal(second.error, null);
    assert.equal(second.data, 'woken');
    const afterSecond = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(afterSecond.held_node_id, snapshotNode, 'second park must not re-snapshot');
    assert.equal(afterSecond.held_next_run_at, snapshotNextRun);

    // Branch.
    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.reply_thread_id, threadId);
    const branchedNode = branched.current_node_id;

    // A reply AFTER the branch must return 'branched' and must NOT stop or
    // re-route the enrollment (it is actively walking the branch).
    await deliverReply(harness, seeded, { bodyText: 'One more thought!' });
    const afterLateReply = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(afterLateReply.state, 'active', 'post-branch reply must not stop the enrollment');
    assert.equal(afterLateReply.reply_thread_id, threadId, 'branch decision is immutable');
    assert.equal(afterLateReply.current_node_id, branchedNode, 'post-branch reply must not re-route');

    // The next tick processes the branch target (email-3), not the
    // categorizer - the branch decision is final and re-classification is moot.
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const stable = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(stable.reply_thread_id, threadId);
    assert.equal(stable.current_node_id, branchedNode, 'stays on the branch target');
  } finally {
    await harness.cleanup();
  }
});

test('thread mailbox unavailable: campaign_priority job is NOT created (no fallback mailbox), retries in 6h, recovers when the mailbox returns', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-mailbox') });
  resetCategorizerLlmFailureTracking();
  resetPriorityEmailWarningTracking();

  try {
    const seeded = await seedMidSequence(harness, { name: 'Categorizer Mailbox Unavailable', useAi: true });
    await deliverReply(harness, seeded, { bodyText: 'Very interested!' });
    const threadId = await latestThreadId(harness, seeded.enrollmentId);

    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    // Knock out the thread mailbox before the reply email is armed.
    const thread = await getThreadRow(harness, threadId);
    await harness.supabase
      .from('mailboxes')
      .update({ status: 'error', updated_at: new Date().toISOString() } as any)
      .eq('id', thread.mailbox_id);

    const before = Date.now();
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const { data: replyJobs } = await harness.supabase
      .from('message_jobs')
      .select('id')
      .eq('enrollment_id', seeded.enrollmentId)
      .in('message_type', ['campaign_priority', 'campaign_reply']);
    assert.equal(replyJobs?.length, 0, 'no job may be created against an unavailable mailbox');

    const deferred = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(deferred.state, 'active');
    const nextRunMs = Date.parse(deferred.next_run_at);
    assert.ok(
      nextRunMs >= before + 5 * 60 * 60_000 && nextRunMs <= before + 7 * 60 * 60_000,
      `6h self-heal retry expected (got ${deferred.next_run_at})`,
    );

    // Mailbox comes back: the next tick creates the job from the SAME mailbox.
    await harness.supabase
      .from('mailboxes')
      .update({ status: 'connected', smtp_status: 'active', updated_at: new Date().toISOString() } as any)
      .eq('id', thread.mailbox_id);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const { data: createdJobs } = await harness.supabase
      .from('message_jobs')
      .select('id, mailbox_id, message_type')
      .eq('enrollment_id', seeded.enrollmentId)
      .in('message_type', ['campaign_priority', 'campaign_reply']);
    assert.equal(createdJobs?.length, 1);
    assert.equal(createdJobs?.[0]?.mailbox_id, thread.mailbox_id, 'always the thread mailbox, never a fallback');
    assert.equal(createdJobs?.[0]?.message_type, 'campaign_priority');
  } finally {
    await harness.cleanup();
  }
});

test('campaign_priority scheduling respects the campaign schedule window', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-window') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequence(harness, {
      name: 'Categorizer Reply Schedule Window',
      useAi: true,
      schedule: CHICAGO_SCHEDULE,
    });
    await deliverReply(harness, seeded, { bodyText: 'Interested!' });
    const threadId = await latestThreadId(harness, seeded.enrollmentId);

    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Interested' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]); // branch
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]); // arm reply email

    const { data: replyJobs } = await harness.supabase
      .from('message_jobs')
      .select('scheduled_at')
      .eq('enrollment_id', seeded.enrollmentId)
      .in('message_type', ['campaign_priority', 'campaign_reply']);
    assert.equal(replyJobs?.length, 1);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = new Map(
      formatter.formatToParts(new Date(replyJobs![0]!.scheduled_at)).map((p) => [p.type, p.value]),
    );
    assert.ok(
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.get('weekday') ?? ''),
      `reply scheduled on a weekday (got ${replyJobs![0]!.scheduled_at})`,
    );
    const hour = Number(parts.get('hour'));
    assert.ok(hour >= 9 && hour <= 17, `reply scheduled inside business hours (got hour ${hour})`);
  } finally {
    await harness.cleanup();
  }
});

test('priority node with no reply_thread_id still arms a campaign_priority job from the lead mailbox', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-nothread') });
  resetPriorityEmailWarningTracking();
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Priority Node No Thread',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'no-thread',
          email: `no-thread-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            // Directly at the priority email with no upstream branch /
            // reply_thread_id. Priority no longer requires a reply thread.
            state: 'active',
            currentFlowNodeId: 'email-3',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('no-thread')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]);

    const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(enrollment.state, 'active');
    assert.equal(enrollment.stopped_reason, null);

    const { data: jobs } = await harness.supabase
      .from('message_jobs')
      .select('id, message_type, mailbox_id, interval_id, status')
      .eq('enrollment_id', lead.enrollmentId!);
    assert.equal(jobs?.length, 1, 'priority handler must create exactly one job');
    assert.equal(jobs?.[0]?.message_type, 'campaign_priority');
    assert.equal(jobs?.[0]?.mailbox_id, mailboxId);
    assert.equal(jobs?.[0]?.interval_id, null);
    assert.equal(jobs?.[0]?.status, 'queued');
  } finally {
    await harness.cleanup();
  }
});

test('terminal paths cancel holds: bounce and unsubscribe stops leave no restorable holds; restore after stop is a no-op', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-terminal') });
  const now = Date.now();

  try {
    const leadEmailBounce = `bounce-${harness.namespace}@furnace.test`;
    const leadEmailUnsub = `unsub-${harness.namespace}@furnace.test`;
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Terminal Hold Hygiene',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'bounce-lead',
          email: leadEmailBounce,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            // Pre-held state (reply already processed).
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: new Date(now + 60_000).toISOString(),
            heldNodeFlowNodeId: 'waitTime-1',
            heldNextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig-bounce-${harness.namespace}@furnace.test>`,
            }),
            buildCampaignJob({
              key: 'held-2',
              nodeFlowNodeId: 'email-2',
              status: 'held',
              statusReason: null,
              scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            }),
          ],
        }),
        buildCampaignLead({
          key: 'unsub-lead',
          email: leadEmailUnsub,
          mailboxKey: 'mailbox-2',
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
              mailboxKey: 'mailbox-2',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig-unsub-${harness.namespace}@furnace.test>`,
            }),
            buildCampaignJob({
              key: 'queued-2',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
              mailboxKey: 'mailbox-2',
              scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const threadManager = new ThreadManager(harness.supabase as any);

    // --- Bounce path ---
    const bounceLead = graph.leadsByKey.get('bounce-lead')!;
    const { data: bounceSentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id')
      .eq('id', bounceLead.messageJobIdsByKey.get('sent-1')!)
      .single();
    const bounceMailbox = await getMailboxRow(harness, bounceSentJob!.mailbox_id);
    // Soft bounce on purpose: stops the enrollment the same way, but avoids
    // a block_list write polluting the shared dev account.
    await threadManager.handleBounce(
      bounceMailbox,
      buildProcessedReply({
        leadEmail: 'mailer-daemon@example.com',
        mailboxEmail: bounceMailbox.email_address,
        inReplyTo: null,
        references: null,
        subject: 'Delivery Status Notification (Failure)',
        bodyText: `421 4.2.1 mailbox temporarily unavailable: ${leadEmailBounce}`,
        bodyHtml: null,
      }),
    );

    const bounceEnrollment = await getEnrollmentRow(harness, bounceLead.enrollmentId!);
    assert.equal(bounceEnrollment.state, 'stopped');
    assert.equal(bounceEnrollment.stopped_reason, 'bounced');
    assert.equal(bounceEnrollment.held_node_id, null, 'bounce stop clears the hold snapshot');
    const { data: bounceHeld } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', bounceLead.messageJobIdsByKey.get('held-2')!)
      .single();
    assert.equal(bounceHeld?.status, 'cancelled');
    assert.equal(bounceHeld?.status_reason, 'reply_received');

    // Restore after a terminal stop is a strict no-op.
    const restoreAfterStop = await harness.supabase.rpc('restore_enrollment_outbound', {
      p_enrollment_id: bounceLead.enrollmentId!,
      p_resume_at: new Date().toISOString(),
    });
    assert.equal(restoreAfterStop.error, null);
    assert.equal(restoreAfterStop.data, false);
    const { data: stillCancelled } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', bounceLead.messageJobIdsByKey.get('held-2')!)
      .single();
    assert.equal(stillCancelled?.status, 'cancelled', 'restore never resurrects cancelled jobs');

    // --- Unsubscribe path (categorizer flow keeps the legacy hard stop) ---
    const unsubLead = graph.leadsByKey.get('unsub-lead')!;
    const { data: unsubSentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', unsubLead.messageJobIdsByKey.get('sent-1')!)
      .single();
    const unsubMailbox = await getMailboxRow(harness, unsubSentJob!.mailbox_id);
    const handled = await threadManager.handleReply(
      unsubMailbox,
      buildProcessedReply({
        leadEmail: leadEmailUnsub,
        mailboxEmail: unsubMailbox.email_address,
        inReplyTo: unsubSentJob!.provider_message_id,
        bodyText: 'Unsubscribe me please.',
      }),
      { isUnsubscribe: true },
    );
    assert.equal(handled, true);

    const unsubEnrollment = await getEnrollmentRow(harness, unsubLead.enrollmentId!);
    assert.equal(unsubEnrollment.state, 'stopped', 'unsubscribe keeps the legacy hard stop');
    assert.equal(unsubEnrollment.stopped_reason, 'replied');
    assert.equal(unsubEnrollment.held_node_id, null);
  } finally {
    await harness.cleanup();
  }
});

test('restore never reschedules sent or cancelled jobs (duplicate-send guard)', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-dupsend') });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Restore Duplicate Guard',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'mixed',
          email: `mixed-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: new Date(now + 60_000).toISOString(),
            heldNodeFlowNodeId: 'waitTime-1',
            heldNextRunAt: new Date(now + 60 * 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              scheduledAt: new Date(now - 60 * 60_000).toISOString(),
              sentAt: new Date(now - 60 * 60_000).toISOString(),
              providerMessageId: `<orig-mixed-${harness.namespace}@furnace.test>`,
            }),
            buildCampaignJob({
              key: 'held-2',
              nodeFlowNodeId: 'email-2',
              status: 'held',
              statusReason: null,
              scheduledAt: new Date(now + 2 * 60 * 60_000).toISOString(),
            }),
            buildCampaignJob({
              key: 'cancelled-extra',
              nodeFlowNodeId: 'email-2',
              status: 'cancelled',
              statusReason: 'manually_cancelled',
              scheduledAt: new Date(now - 30 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('mixed')!;
    const restore = await harness.supabase.rpc('restore_enrollment_outbound', {
      p_enrollment_id: lead.enrollmentId!,
      p_resume_at: null,
    });
    assert.equal(restore.error, null);
    assert.equal(restore.data, true);

    const { data: jobs } = await harness.supabase
      .from('message_jobs')
      .select('id, status')
      .eq('enrollment_id', lead.enrollmentId!);
    const byId = new Map((jobs ?? []).map((j: any) => [j.id, j.status]));
    assert.equal(byId.get(lead.messageJobIdsByKey.get('sent-1')!), 'sent', 'sent jobs untouched');
    assert.equal(byId.get(lead.messageJobIdsByKey.get('held-2')!), 'queued', 'held job restored');
    assert.equal(
      byId.get(lead.messageJobIdsByKey.get('cancelled-extra')!),
      'cancelled',
      'cancelled jobs never resurrected',
    );
  } finally {
    await harness.cleanup();
  }
});

test('categorizer node deleted mid-park: wake/sweep skip it and the scheduler does not corrupt the enrollment', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-fail-nodedel') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Node Deleted Mid Park',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'orphan',
          email: `orphan-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: null,
          }),
          thread: {
            subject: 'Quick check-in',
            lastMessageAt: new Date().toISOString(),
            hasReply: true,
            category: 'Interested',
            categorySource: 'user',
          },
        }),
      ],
    });

    const lead = graph.leadsByKey.get('orphan')!;
    const categorizerNodeId = graph.nodeIdsByFlowNodeId.get('aiCategorizer-1')!;

    // Categorizer node soft-deleted (flow edited mid-park).
    await harness.supabase
      .from('nodes')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
      .eq('id', categorizerNodeId);

    // Sweep must skip enrollments whose categorizer node is gone.
    const sweep = await harness.supabase.rpc('sweep_parked_categorizer_enrollments', {
      p_batch_size: 200,
    });
    assert.equal(sweep.error, null);
    const afterSweep = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.equal(afterSweep.next_run_at, null, 'sweep skips deleted categorizer nodes');

    // Direct scheduler processing must not crash or corrupt state.
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [lead.enrollmentId!]).catch(() => {
      // Worker-level error handling may rethrow; the assertion below is on row state.
    });
    const after = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.ok(
      ['active', 'stopped', 'completed'].includes(after.state),
      'enrollment remains in a recognized state',
    );
    assert.equal(after.reply_thread_id, null, 'no phantom branch was taken');
  } finally {
    await harness.cleanup();
  }
});
