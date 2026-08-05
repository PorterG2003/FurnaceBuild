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
  createTestSchedulerWorker,
  getEnrollmentRow,
  getJobsForEnrollment,
  getMailboxRow,
  processEnrollmentIds,
  simulateClassifyLambda,
} from './categorizer-helpers';

/**
 * User category correction re-arm via wake_enrollment_for_thread_category:
 * Neutral no-edge complete → Interested flip → priority branch;
 * stopped/replied Wait orphan → Interested flip → priority branch;
 * idempotent when campaign_priority already sent.
 */

type SeededLead = {
  graph: MaterializedCampaignGraph;
  enrollmentId: string;
  leadEmail: string;
  sentJobId: string;
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
    enrollmentId: lead.enrollmentId!,
    leadEmail,
    sentJobId: lead.messageJobIdsByKey.get('sent-1')!,
  };
}

async function deliverReply(
  harness: CampaignDbHarness,
  seeded: SeededLead,
  params: { bodyText: string },
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

test('Neutral no-edge complete then user Interested re-arms onto Interested priority email', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-rearm-complete') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Rearm Complete', useAi: true });
    const { graph } = seeded;

    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Hmm, not sure. Circle back next quarter maybe.',
    });

    await simulateClassifyLambda(harness, { threadId }, [{ kind: 'classify', category: 'Neutral' }]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const completed = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.reply_thread_id, threadId);

    await harness.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'user',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', threadId);

    const wake = await harness.supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
    assert.equal(wake.error, null);
    assert.equal(wake.data, true, 're-arm RPC must reactivate completed@categorizer');

    const rearmed = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(rearmed.state, 'active');
    assert.equal(rearmed.current_node_id, graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.equal(rearmed.reply_thread_id, threadId);
    assert.ok(rearmed.next_run_at);

    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-3'));

    // Second tick arms the priority email node.
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const jobs = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const priority = jobs.find(
      (j) =>
        j.node_id === graph.nodeIdsByFlowNodeId.get('email-3') &&
        j.message_type === 'campaign_priority',
    );
    assert.ok(priority, 'Interested edge must arm campaign_priority job');
  } finally {
    await harness.cleanup();
  }
});

test('stopped/replied Wait orphan then user Interested re-arms onto categorizer then Interested email', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-rearm-orphan') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Rearm Orphan', useAi: true });
    const { graph } = seeded;

    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Yes please, send the link!',
    });

    // Historical park-miss orphan fingerprint.
    await harness.supabase
      .from('enrollments')
      .update({
        state: 'stopped',
        stopped_reason: 'replied',
        stopped_at: new Date().toISOString(),
        reply_thread_id: null,
        current_node_id: graph.nodeIdsByFlowNodeId.get('waitTime-1')!,
        next_run_at: null,
        held_node_id: null,
        held_next_run_at: null,
      } as any)
      .eq('id', seeded.enrollmentId);

    await harness.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'user',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', threadId);

    const wake = await harness.supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
    assert.equal(wake.error, null);
    assert.equal(wake.data, true, 're-arm must revive stopped/replied orphan');

    const rearmed = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(rearmed.state, 'active');
    assert.equal(rearmed.stopped_reason, null);
    assert.equal(rearmed.current_node_id, graph.nodeIdsByFlowNodeId.get('aiCategorizer-1'));
    assert.equal(rearmed.reply_thread_id, threadId);

    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    const branched = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(branched.current_node_id, graph.nodeIdsByFlowNodeId.get('email-3'));
  } finally {
    await harness.cleanup();
  }
});

test('re-arm is idempotent when campaign_priority already sent', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-rearm-idem') });
  resetCategorizerLlmFailureTracking();

  try {
    const seeded = await seedMidSequenceLead(harness, { name: 'Rearm Idempotent', useAi: true });
    const { graph } = seeded;

    const { threadId } = await deliverReply(harness, seeded, {
      bodyText: 'Yes please!',
    });
    await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);
    await processEnrollmentIds(harness, scheduler, [seeded.enrollmentId]);

    const jobs = await getJobsForEnrollment(harness, seeded.enrollmentId);
    const priority = jobs.find(
      (j) =>
        j.node_id === graph.nodeIdsByFlowNodeId.get('email-3') &&
        j.message_type === 'campaign_priority',
    );
    assert.ok(priority, 'priority email must create a campaign_priority job');
    await harness.supabase
      .from('message_jobs')
      .update({
        status: 'sent',
        message_type: 'campaign_priority',
        sent_at: new Date().toISOString(),
      } as any)
      .eq('id', priority!.id);

    await harness.supabase
      .from('enrollments')
      .update({
        state: 'completed',
        current_node_id: graph.nodeIdsByFlowNodeId.get('aiCategorizer-1')!,
        reply_thread_id: threadId,
        next_run_at: null,
      } as any)
      .eq('id', seeded.enrollmentId);

    await harness.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'user',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', threadId);

    const wake = await harness.supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: threadId,
    });
    assert.equal(wake.error, null);
    assert.equal(wake.data, false, 'must not re-arm when priority already sent');

    const still = await getEnrollmentRow(harness, seeded.enrollmentId);
    assert.equal(still.state, 'completed');
  } finally {
    await harness.cleanup();
  }
});
