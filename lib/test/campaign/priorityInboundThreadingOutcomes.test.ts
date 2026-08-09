/**
 * Contract: campaign_priority In-Reply-To must target the inbound Message-ID that
 * triggered the categorizer branch (most recent thread message), not the prior outbound.
 *
 * See docs/engineering/email-threading-test-contract.md §8.
 */
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
  assertCumulativeReferences,
  assertImmediateParent,
  assertNoUnresolvedTemplate,
  assertPersistenceParity,
} from '../inbox/threadingAssertions';
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

async function seedRunningCategorizerLead(harness: CampaignDbHarness) {
  const now = Date.now();
  const leadEmail = `lead-${harness.namespace}@example.com`;
  const outboundId = `<orig-${harness.namespace}@furnace.test>`;
  const graph = await harness.createCampaignGraph({
    name: 'Priority Inbound Threading',
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
            providerMessageId: outboundId,
            messageData: {
              source: 'campaign_seed',
              sent_subject: 'Pricing follow-up',
              node_config: {
                subject: 'Pricing follow-up',
                body_html: '<p>Hi</p>',
                body_text: 'Hi',
              },
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
    outboundId,
    enrollmentId: lead.enrollmentId!,
    sentJobId: lead.messageJobIdsByKey.get('sent-1')!,
    queuedJobId: lead.messageJobIdsByKey.get('queued-2')!,
  };
}

async function claimAndReleaseCollateral(
  harness: CampaignDbHarness,
  priorityJobId: string,
): Promise<void> {
  const claim = await harness.supabase.rpc('claim_manual_message_jobs_ready', {
    p_batch_size: 50,
    p_processing_timeout_minutes: 5,
  });
  assert.equal(claim.error, null);
  const claimedRows = (claim.data ?? []) as any[];
  assert.ok(
    claimedRows.find((r) => r.id === priorityJobId),
    'claim_manual_message_jobs_ready must claim the campaign_priority job',
  );
  const collateral = claimedRows.filter((r) => r.id !== priorityJobId).map((r) => r.id);
  if (collateral.length > 0) {
    await harness.supabase
      .from('message_jobs')
      .update({
        status: 'queued',
        status_reason: null,
        reserved_at: null,
        updated_at: new Date().toISOString(),
      } as any)
      .in('id', collateral)
      .eq('status', 'reserved');
  }
}

test('priority send parents the triggering inbound Message-ID, not the prior outbound', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('priority-inbound-threading'),
  });

  try {
    const seeded = await seedRunningCategorizerLead(harness);
    const { graph, enrollmentId, sentJobId, queuedJobId, leadEmail, outboundId } = seeded;

    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', sentJobId)
      .single();
    const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);
    const inbound = buildProcessedReply({
      leadEmail,
      mailboxEmail: mailbox.email_address,
      inReplyTo: sentJob!.provider_message_id,
      subject: 'Re: Pricing follow-up',
      bodyText: 'Yes — send pricing please.',
    });
    const handled = await new ThreadManager(harness.supabase as any).handleReply(mailbox, inbound);
    assert.equal(handled, true, 'inbox-checker must accept the reply');

    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('id')
      .eq('enrollment_id', enrollmentId)
      .eq('has_reply', true)
      .order('last_message_at', { ascending: false })
      .limit(1);
    const threadId = threads?.[0]?.id as string;
    assert.ok(threadId);

    const { data: inboundRow } = await harness.supabase
      .from('email_messages')
      .select('id, message_id, subject, in_reply_to, message_references')
      .eq('thread_id', threadId)
      .eq('direction', 'received')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();
    assert.ok(inboundRow?.message_id, 'inbound must have a Message-ID');
    assert.equal(
      String(inboundRow!.message_id).toLowerCase(),
      inbound.messageId.replace(/^<|>$/g, '').toLowerCase(),
    );

    const classify = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    assert.equal(classify.ok, true);

    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);

    const jobs = await getJobsForEnrollment(harness, enrollmentId);
    const priorityJob = jobs.find((j) => j.message_type === 'campaign_priority');
    assert.ok(priorityJob, 'priority node must create a campaign_priority job');
    assert.equal(
      (await harness.supabase.from('message_jobs').select('status').eq('id', queuedJobId).single())
        .data?.status,
      'cancelled',
    );

    await claimAndReleaseCollateral(harness, priorityJob.id);

    const captures: CapturedCampaignSend[] = [];
    const { data: reserved } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', priorityJob.id)
      .single();
    await (createTestSendWorker(harness, { captures }) as any).processMessageJob(reserved);

    const { data: sent } = await harness.supabase
      .from('message_jobs')
      .select('status, provider_message_id, message_data')
      .eq('id', priorityJob.id)
      .single();
    assert.equal(sent?.status, 'sent');

    assert.equal(captures.length, 1, 'exactly one SMTP capture for priority');
    const smtp = captures[0]!;
    assertNoUnresolvedTemplate(smtp.subject, 'priority SMTP subject');

    // Contract §8: parent the inbound that triggered the branch.
    assertImmediateParent(
      smtp.inReplyTo,
      inbound.messageId,
      'priority In-Reply-To must equal triggering inbound Message-ID',
    );
    assert.notEqual(
      smtp.inReplyTo?.replace(/^<|>$/g, '').toLowerCase(),
      outboundId.replace(/^<|>$/g, '').toLowerCase(),
      'priority must not parent the prior outbound when an inbound is newer',
    );
    assertCumulativeReferences(smtp.references, [outboundId, inbound.messageId], 'priority References');

    const { data: emailMessage } = await harness.supabase
      .from('email_messages')
      .select('subject, in_reply_to, message_references, message_id, body_text, body_html')
      .eq('thread_id', threadId)
      .eq('message_job_id', priorityJob.id)
      .single();
    assert.ok(emailMessage);
    assertImmediateParent(emailMessage!.in_reply_to, inbound.messageId, 'email_messages.in_reply_to');

    const { data: event } = await harness.supabase
      .from('events')
      .select('event_data')
      .eq('message_job_id', priorityJob.id)
      .eq('event_type', 'sent')
      .maybeSingle();

    assertPersistenceParity({
      smtp,
      eventData: (event as any)?.event_data ?? null,
      jobMessageData: (sent as any)?.message_data ?? null,
      emailMessage,
      expectedSubject: smtp.subject,
    });

    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    const final = await getEnrollmentRow(harness, enrollmentId);
    assert.equal(final.state, 'completed');
    void graph;
    void getThreadRow;
  } finally {
    await harness.cleanup();
  }
});

test('multiple inbounds before priority: parent is the newest inbound, not an older inbound or outbound', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('priority-multi-inbound'),
  });

  try {
    const seeded = await seedRunningCategorizerLead(harness);
    const { enrollmentId, sentJobId, leadEmail, outboundId } = seeded;

    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('mailbox_id, provider_message_id')
      .eq('id', sentJobId)
      .single();
    const mailbox = await getMailboxRow(harness, sentJob!.mailbox_id);
    const tm = new ThreadManager(harness.supabase as any);

    const firstInbound = buildProcessedReply({
      leadEmail,
      mailboxEmail: mailbox.email_address,
      inReplyTo: sentJob!.provider_message_id,
      bodyText: 'First inbound',
      date: new Date(Date.now() - 60_000),
    });
    assert.equal(await tm.handleReply(mailbox, firstInbound), true);

    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('id')
      .eq('enrollment_id', enrollmentId)
      .eq('has_reply', true)
      .limit(1);
    const threadId = threads?.[0]?.id as string;
    assert.ok(threadId);

    // Second inbound lands before classify/priority send.
    const secondInbound = buildProcessedReply({
      leadEmail,
      mailboxEmail: mailbox.email_address,
      inReplyTo: firstInbound.messageId,
      references: `${outboundId} ${firstInbound.messageId}`,
      bodyText: 'Second inbound — this is the newest',
      date: new Date(),
    });
    assert.equal(await tm.handleReply(mailbox, secondInbound), true);

    const classify = await simulateClassifyLambda(harness, { threadId }, [
      { kind: 'classify', category: 'Interested' },
    ]);
    assert.equal(classify.ok, true);

    const scheduler = createTestSchedulerWorker(harness);
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);
    await processEnrollmentIds(harness, scheduler, [enrollmentId]);

    const jobs = await getJobsForEnrollment(harness, enrollmentId);
    const priorityJob = jobs.find((j) => j.message_type === 'campaign_priority');
    assert.ok(priorityJob);
    await claimAndReleaseCollateral(harness, priorityJob.id);

    const captures: CapturedCampaignSend[] = [];
    const { data: reserved } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', priorityJob.id)
      .single();
    await (createTestSendWorker(harness, { captures }) as any).processMessageJob(reserved);

    assert.equal(captures.length, 1);
    assertImmediateParent(
      captures[0]!.inReplyTo,
      secondInbound.messageId,
      'priority must parent the newest inbound when multiple arrived before send',
    );
    assert.notEqual(
      captures[0]!.inReplyTo?.replace(/^<|>$/g, '').toLowerCase(),
      firstInbound.messageId.replace(/^<|>$/g, '').toLowerCase(),
    );
  } finally {
    await harness.cleanup();
  }
});
