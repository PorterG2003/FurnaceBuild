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
  createTestSchedulerWorker,
  createTestSendWorker,
  getEnrollmentRow,
  getJobsForEnrollment,
  getMailboxRow,
  getThreadRow,
  processEnrollmentIds,
  simulateClassifyLambda,
  type CapturedCampaignSend,
} from './categorizer-helpers';

/**
 * End-to-end proof of the post-categorizer PRIORITY email path against the real
 * scheduler + send workers and a live DB. It drives the full production flow:
 *
 *   reply -> categorizer branch -> arm campaign_priority job (interval_id null,
 *   thread mailbox) -> priority claim lane (claim_manual_message_jobs_ready) ->
 *   send worker delivery -> immediate recording inside the replied thread ->
 *   enrollment completion.
 *
 * The one seam not running locally is the async classify Lambda, so we run its
 * real core (amplify/functions/classifyReply) against the DB with a scripted
 * LLM via simulateClassifyLambda — it writes the durable category and calls the
 * same wake RPC the Master Inbox uses. Everything downstream is the code under
 * test.
 */

const ROOT_SENT_SUBJECT = 'Quick check-in';

async function seedRunningCategorizerLead(harness: CampaignDbHarness) {
  const now = Date.now();
  const leadEmail = `lead-${harness.namespace}@example.com`;
  const graph = await harness.createCampaignGraph({
    name: 'Priority Email E2E',
    status: 'running',
    flowKind: 'emailWaitEmailCategorizer',
    categorizerUseAi: true,
    mailboxes: [
      {
        key: 'mailbox-1',
        emailAddress: `sender-${harness.namespace}@example.com`,
        displayName: 'Sender',
      },
    ],
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
            // A real send stamps the delivered subject; the priority node's own
            // subject is empty, so this is the subject it must inherit.
            messageData: {
              source: 'campaign_seed',
              sent_subject: ROOT_SENT_SUBJECT,
              node_config: { subject: ROOT_SENT_SUBJECT },
            },
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
    leadEmail,
    enrollmentId: lead.enrollmentId!,
    sentJobId: lead.messageJobIdsByKey.get('sent-1')!,
    queuedJobId: lead.messageJobIdsByKey.get('queued-2')!,
  };
}

test('post-categorizer priority email: branches, arms a campaign_priority job on the priority lane, sends into the thread, and completes', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('priority-email-e2e'),
  });

  try {
    const seeded = await seedRunningCategorizerLead(harness);
    const { graph, enrollmentId, sentJobId, queuedJobId, leadEmail } = seeded;

    // --- Inbound reply: fast-forwards to the categorizer, holds email-2. ---
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', sentJobId)
      .single();
    const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);
    const handled = await new ThreadManager(harness.supabase as any).handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: sentJob!.provider_message_id,
        bodyText: 'This looks great - can you send pricing?',
      }),
    );
    assert.equal(handled, true, 'inbox-checker must accept the reply');

    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('id')
      .eq('enrollment_id', enrollmentId)
      .eq('has_reply', true)
      .order('last_message_at', { ascending: false })
      .limit(1);
    const threadId = threads?.[0]?.id as string;
    assert.ok(threadId, 'reply must land in a replied thread');

    const { data: heldJob } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', queuedJobId)
      .single();
    assert.equal(heldJob?.status, 'held', 'email-2 held on reply');

    // --- Classify Lambda core (real code) classifies Interested + wakes. ---
    const classify = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    assert.equal(classify.ok, true, 'classify Lambda must succeed');

    const scheduler = createTestSchedulerWorker(harness);

    // --- Scheduler tick #1: branch into the priority email node (email-3). ---
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    const branched = await getEnrollmentRow(harness, enrollmentId);
    assert.equal(branched.reply_thread_id, threadId, 'branch sets reply_thread_id');
    assert.equal(
      branched.current_node_id,
      graph.nodeIdsByFlowNodeId.get('email-3'),
      'branch advances to the priority email node',
    );
    assert.equal(branched.held_node_id, null, 'branch clears the hold snapshot');
    const { data: cancelledJob } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', queuedJobId)
      .single();
    assert.equal(cancelledJob?.status, 'cancelled');
    assert.equal(cancelledJob?.status_reason, 'reply_received');

    // --- Scheduler tick #2: arm the campaign_priority job. ---
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    const jobs = await getJobsForEnrollment(harness, enrollmentId);
    const priorityJob = jobs.find((j) => j.message_type === 'campaign_priority');
    assert.ok(priorityJob, 'priority node must create a campaign_priority job');
    assert.equal(priorityJob.status, 'queued');
    assert.equal(priorityJob.interval_id, null, 'campaign_priority bypasses interval pacing');
    assert.equal(priorityJob.node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
    const thread = await getThreadRow(harness, threadId);
    assert.equal(priorityJob.mailbox_id, thread.mailbox_id, 'priority job uses the thread mailbox');

    // --- Priority claim lane must pick it up. ---
    const claim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
      p_batch_size: 50,
      p_processing_timeout_minutes: 5,
    });
    assert.equal(claim.error, null);
    const claimedRows = (claim.data ?? []) as any[];
    assert.ok(
      claimedRows.find((r) => r.id === priorityJob.id),
      'claim_manual_message_jobs_ready must claim the campaign_priority job',
    );
    // Release any collateral dev jobs we happened to claim.
    const collateral = claimedRows.filter((r) => r.id !== priorityJob.id).map((r) => r.id);
    if (collateral.length > 0) {
      await harness.supabase
        .from('message_jobs')
        .update({ status: 'queued', status_reason: null, reserved_at: null, updated_at: new Date().toISOString() } as any)
        .in('id', collateral)
        .eq('status', 'reserved');
    }

    // --- Send worker: deliver + record inside the replied thread. ---
    const messageCountBefore = thread.message_count;
    const { data: reserved } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', priorityJob.id)
      .single();

    const { data: inboundBeforeSend } = await harness.supabase
      .from('email_messages')
      .select('message_id')
      .eq('thread_id', threadId)
      .eq('direction', 'received')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();
    assert.ok(inboundBeforeSend?.message_id);

    const captures: CapturedCampaignSend[] = [];
    await (createTestSendWorker(harness, { captures }) as any).processMessageJob(reserved);

    const { data: sent } = await harness.supabase
      .from('message_jobs')
      .select('status, provider_message_id, message_data')
      .eq('id', priorityJob.id)
      .single();
    assert.equal(sent?.status, 'sent', 'priority job sent');
    assert.ok(sent?.provider_message_id, 'provider_message_id stamped');
    assert.equal(captures.length, 1);
    assert.equal(
      captures[0]!.subject,
      ROOT_SENT_SUBJECT,
      'priority node has an empty subject, so it must inherit the epoch subject',
    );
    assert.equal(
      captures[0]!.inReplyTo?.replace(/^<|>$/g, '').toLowerCase(),
      String(inboundBeforeSend!.message_id).toLowerCase(),
      'priority In-Reply-To must equal triggering inbound Message-ID',
    );
    assert.ok(
      captures[0]!.references && captures[0]!.references.length > 0,
      'priority References must be populated',
    );
    assert.equal(
      (sent as any)?.message_data?.sent_subject,
      captures[0]!.subject,
      'message_data.sent_subject must match SMTP subject',
    );

    const { data: sentMessages } = await harness.supabase
      .from('email_messages')
      .select('direction, message_job_id, subject, in_reply_to, message_references')
      .eq('thread_id', threadId)
      .eq('message_job_id', priorityJob.id);
    assert.equal(sentMessages?.length, 1, 'exactly one recorded outbound message');
    assert.equal(sentMessages?.[0]?.direction, 'sent');
    assert.equal(sentMessages?.[0]?.subject, captures[0]!.subject);
    assert.equal(
      String(sentMessages?.[0]?.in_reply_to ?? '').toLowerCase(),
      String(inboundBeforeSend!.message_id).toLowerCase(),
    );
    const threadAfterSend = await getThreadRow(harness, threadId);
    assert.equal(
      threadAfterSend.message_count,
      messageCountBefore + 1,
      'thread message_count incremented (immediate Master Inbox recording)',
    );

    // --- Scheduler tick #3: no further edges -> completed. ---
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    const final = await getEnrollmentRow(harness, enrollmentId);
    assert.equal(final.state, 'completed', 'enrollment completes after the priority email');
  } finally {
    await harness.cleanup();
  }
});
