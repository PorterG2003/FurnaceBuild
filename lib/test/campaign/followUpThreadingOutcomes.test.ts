import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { SendWorker } from '../../../workers/send-worker/src/worker';
import { processSpintax } from '../../email/processSpintax';
import { mergeTemplate } from '../../email/mergeTemplate';

const FIRST_SUBJECT_TEMPLATE = '{Alpha {{first_name}}|Beta {{first_name}}|Gamma {{first_name}}}';

type CapturedSend = {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
};

async function createThreadingGraph(harness: CampaignDbHarness, leadKey: string) {
  return harness.createCampaignGraph({
    name: 'Follow-up Threading Outcomes',
    status: 'running',
    flowKind: 'emailWaitEmail',
    mailboxes: [
      {
        key: 'mailbox-1',
        emailAddress: `sender-${harness.namespace}@example.com`,
        displayName: 'Sender',
      },
    ],
    leads: [
      buildCampaignLead({
        key: leadKey,
        email: `lead-${leadKey}-${harness.namespace}@example.com`,
        firstName: 'Casey',
        enrollment: buildCampaignEnrollment({
          state: 'active',
          currentFlowNodeId: 'email-1',
          nextRunAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    ],
  });
}

async function insertReservedCampaignJob(opts: {
  harness: CampaignDbHarness;
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>;
  lead: { enrollmentId: string; leadId: string };
  mailboxId: string;
  nodeId: string | null;
  subject: string;
  bodyHtml?: string;
  messageType?: string;
}) {
  const messageJobId = randomUUID();
  const scheduledAt = new Date().toISOString();
  const { error } = await opts.harness.supabase.from('message_jobs').insert({
    id: messageJobId,
    enrollment_id: opts.lead.enrollmentId,
    campaign_id: opts.graph.campaignId,
    account_id: opts.graph.accountId,
    lead_id: opts.lead.leadId,
    mailbox_id: opts.mailboxId,
    node_id: opts.nodeId,
    status: 'reserved',
    scheduled_at: scheduledAt,
    reserved_at: scheduledAt,
    lease_expires_at: null,
    claim_token: null,
    sending_started_at: null,
    sent_at: null,
    provider_message_id: null,
    error_message: null,
    retry_count: 0,
    message_type: opts.messageType ?? 'campaign',
    send_wait_reason: null,
    interval_id: null,
    throttle_bypass_next_attempt: true,
    message_data: {
      node_config: {
        subject: opts.subject,
        body_html: opts.bodyHtml ?? '<p>Body</p>',
        body_text: 'Body',
      },
    },
  } as any);
  assert.equal(error, null);
  opts.graph.manifest.messageJobIds.push(messageJobId);
  return messageJobId;
}

function createSendWorker(
  harness: CampaignDbHarness,
  captures: CapturedSend[],
  providerMessageIdFactory: (callIndex: number) => string,
) {
  let callIndex = 0;
  const sendWorker = new SendWorker({
    supabase: harness.supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (
      _transporter: unknown,
      _mailbox: unknown,
      messageJob: { id: string },
      _lead: unknown,
      subject: string,
      _emailBody: string,
      inReplyTo: string | null,
      references: string | null,
    ) => {
      captures.push({ subject, inReplyTo, references });
      const id = providerMessageIdFactory(callIndex);
      callIndex += 1;
      return {
        submittedMessageId: `<${messageJob.id}@furnace.build>`,
        providerMessageId: id,
      };
    },
  });
  (sendWorker as any).smtpPool = {
    getTransporter: async () => ({}),
    markMessageSent: () => {},
    closeAll: async () => {},
  };
  return sendWorker;
}

async function loadJob(harness: CampaignDbHarness, messageJobId: string) {
  const { data, error } = await harness.supabase
    .from('message_jobs')
    .select('*')
    .eq('id', messageJobId)
    .single();
  assert.equal(error, null);
  return data;
}

async function sendWithPinnedRandom(
  sendWorker: SendWorker,
  messageJob: unknown,
  randomValue: number,
) {
  const originalRandom = Math.random;
  Math.random = () => randomValue;
  try {
    await (sendWorker as any).processMessageJob(messageJob);
  } finally {
    Math.random = originalRandom;
  }
}

async function assertFirstSentSubjectPersisted(
  harness: CampaignDbHarness,
  messageJobId: string,
  expectedSubject: string,
) {
  const { data: event, error: eventError } = await harness.supabase
    .from('events')
    .select('event_data')
    .eq('message_job_id', messageJobId)
    .eq('event_type', 'sent')
    .single();
  assert.equal(eventError, null);
  assert.equal((event as any).event_data.sent_subject, expectedSubject);

  const { data: job, error: jobError } = await harness.supabase
    .from('message_jobs')
    .select('message_data, provider_message_id')
    .eq('id', messageJobId)
    .single();
  assert.equal(jobError, null);
  assert.equal((job as any).message_data.sent_subject, expectedSubject);
  return job as { provider_message_id: string; message_data: { sent_subject: string } };
}

test('empty follow-up subject reuses exact first sent_subject and thread headers', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('followup-empty'),
  });

  try {
    const graph = await createThreadingGraph(harness, 'empty-target');
    const lead = graph.leadsByKey.get('empty-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1NodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const job1Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1NodeId,
      subject: FIRST_SUBJECT_TEMPLATE,
    });
    const job2Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: '',
    });

    const captures: CapturedSend[] = [];
    const sendWorker = createSendWorker(harness, captures, (i) =>
      i === 0 ? '<first@example.com>' : '<followup@example.com>',
    );

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job1Id), 0);
    const firstJob = await assertFirstSentSubjectPersisted(harness, job1Id, 'Alpha Casey');

    // Would pick Beta if we re-spun the first template with this seed.
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    let spunAlternate: string;
    try {
      spunAlternate = mergeTemplate(
        processSpintax(FIRST_SUBJECT_TEMPLATE, { deterministic: false }),
        { first_name: 'Casey' },
      );
    } finally {
      Math.random = originalRandom;
    }
    assert.equal(spunAlternate, 'Beta Casey');
    assert.notEqual(firstJob.message_data.sent_subject, spunAlternate);

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job2Id), 0.5);

    assert.equal(captures.length, 2);
    assert.equal(captures[1]!.subject, firstJob.message_data.sent_subject);
    assert.equal(captures[1]!.subject, 'Alpha Casey');
    assert.notEqual(captures[1]!.subject, spunAlternate);
    assert.equal(captures[1]!.inReplyTo, firstJob.provider_message_id);
    assert.equal(captures[1]!.references, firstJob.provider_message_id);

    const { data: followUpEvent, error: followUpEventError } = await harness.supabase
      .from('events')
      .select('event_data')
      .eq('message_job_id', job2Id)
      .eq('event_type', 'sent')
      .single();
    assert.equal(followUpEventError, null);
    assert.equal((followUpEvent as any).event_data.sent_subject, 'Alpha Casey');
  } finally {
    await harness.cleanup();
  }
});

test('(No subject) follow-up reuses exact first sent_subject', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('followup-no-subject'),
  });

  try {
    const graph = await createThreadingGraph(harness, 'no-subject-target');
    const lead = graph.leadsByKey.get('no-subject-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1NodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const job1Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1NodeId,
      subject: FIRST_SUBJECT_TEMPLATE,
    });
    const job2Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: '(No subject)',
    });

    const captures: CapturedSend[] = [];
    const sendWorker = createSendWorker(harness, captures, (i) =>
      i === 0 ? '<first-ns@example.com>' : '<followup-ns@example.com>',
    );

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job1Id), 0);
    const firstJob = await assertFirstSentSubjectPersisted(harness, job1Id, 'Alpha Casey');

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job2Id), 0.99);

    assert.equal(captures.length, 2);
    assert.equal(captures[1]!.subject, firstJob.message_data.sent_subject);
    assert.equal(captures[1]!.inReplyTo, firstJob.provider_message_id);
    assert.equal(captures[1]!.references, firstJob.provider_message_id);
  } finally {
    await harness.cleanup();
  }
});

test('intentional follow-up subject starts a new thread with no inherited headers', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('followup-intentional'),
  });

  try {
    const graph = await createThreadingGraph(harness, 'intentional-target');
    const lead = graph.leadsByKey.get('intentional-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1NodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const job1Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1NodeId,
      subject: FIRST_SUBJECT_TEMPLATE,
    });
    const job2Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: 'Brand new subject',
    });

    const captures: CapturedSend[] = [];
    const sendWorker = createSendWorker(harness, captures, (i) =>
      i === 0 ? '<first-int@example.com>' : '<followup-int@example.com>',
    );

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job1Id), 0);
    const firstJob = await assertFirstSentSubjectPersisted(harness, job1Id, 'Alpha Casey');

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job2Id), 0.5);

    assert.equal(captures.length, 2);
    assert.equal(captures[1]!.subject, 'Brand new subject');
    assert.notEqual(captures[1]!.subject, firstJob.message_data.sent_subject);
    // Contract: explicit subject starts a new conversation — no inherited headers.
    assert.equal(captures[1]!.inReplyTo, null);
    assert.equal(captures[1]!.references, null);
  } finally {
    await harness.cleanup();
  }
});

test('empty → explicit rendered subject → blank priority continues newest epoch only', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('followup-epoch'),
  });

  try {
    const graph = await createThreadingGraph(harness, 'epoch-target');
    const lead = graph.leadsByKey.get('epoch-target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1NodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const job1Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1NodeId,
      subject: '',
    });
    const job2Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: '{New angle {{first_name}}|Fresh take {{first_name}}}',
    });
    const job3Id = await insertReservedCampaignJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: null,
      subject: '',
      messageType: 'campaign_priority',
    });

    const captures: CapturedSend[] = [];
    const sendWorker = createSendWorker(harness, captures, (i) =>
      i === 0 ? '<epoch-root@example.com>' : i === 1 ? '<epoch-new@example.com>' : '<epoch-blank@example.com>',
    );

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job1Id), 0);
    assert.equal(captures[0]!.subject, '');
    assert.equal(captures[0]!.inReplyTo, null);

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job2Id), 0);
    assert.equal(captures[1]!.subject, 'New angle Casey');
    assert.equal(captures[1]!.inReplyTo, null, 'explicit subject starts new thread');
    assert.equal(captures[1]!.references, null);

    await sendWithPinnedRandom(sendWorker, await loadJob(harness, job3Id), 0.5);
    assert.equal(
      captures[2]!.subject,
      'New angle Casey',
      'blank after explicit must reuse newest epoch, not empty root',
    );
    assert.equal(captures[2]!.inReplyTo, '<epoch-new@example.com>');
  } finally {
    await harness.cleanup();
  }
});
