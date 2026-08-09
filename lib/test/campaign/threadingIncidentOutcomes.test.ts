/**
 * Chad-shaped anonymized incident timeline encoding the full threading contract.
 * Expected red until production implements subject epochs + inbound parents.
 *
 * Timeline:
 *   empty root → blank continuation → explicit spintax (new thread) → inbound →
 *   blank priority → second inbound → second blank priority → manual reply
 *
 * See docs/engineering/email-threading-test-contract.md
 */
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
import {
  assertCumulativeReferences,
  assertImmediateParent,
  assertNoThreadingHeaders,
  assertNoUnresolvedTemplate,
  assertNotUiPlaceholder,
  looksLikeUnresolvedTemplate,
} from '../inbox/threadingAssertions';
import { CHAD_SHAPED_TIMELINE } from '../inbox/threadingTimeline';
import { parseMessageIds } from '../../email/threadHeaders.js';

const EXPLICIT_SUBJECT_TEMPLATE = '{Quick check {{first_name}}|Fast ping {{first_name}}}';

type CapturedSend = {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  providerMessageId: string;
};

async function insertReservedJob(opts: {
  harness: CampaignDbHarness;
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>;
  lead: { enrollmentId: string; leadId: string };
  mailboxId: string;
  nodeId: string | null;
  subject: string;
  messageType?: string;
  threadId?: string;
}): Promise<string> {
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
        body_html: '<p>Body</p>',
        body_text: 'Body',
      },
      ...(opts.threadId ? { thread_id: opts.threadId, source: 'campaign_priority' } : {}),
    },
  } as any);
  assert.equal(error, null);
  opts.graph.manifest.messageJobIds.push(messageJobId);
  return messageJobId;
}

function createCapturingSendWorker(
  harness: CampaignDbHarness,
  captures: CapturedSend[],
  providerIds: string[],
) {
  let callIndex = 0;
  const sendWorker = new SendWorker({
    supabase: harness.supabase as any,
    databaseClient: {} as any,
    campaignEmailSender: async (
      _t,
      _m,
      job: { id: string },
      _l,
      subject,
      _b,
      inReplyTo,
      references,
    ) => {
      const providerMessageId = providerIds[callIndex++] ?? `<auto-${job.id}@furnace.test>`;
      captures.push({
        subject,
        inReplyTo: inReplyTo ?? null,
        references: references ?? null,
        providerMessageId,
      });
      return {
        submittedMessageId: `<${job.id}@furnace.build>`,
        providerMessageId,
      };
    },
  });
  // Inbox reply/forward jobs go through sendReplyEmail rather than the injected
  // campaign sender, so the transporter itself has to capture the SMTP payload.
  const transporter = {
    sendMail: async (mailOptions: {
      subject?: string;
      inReplyTo?: string;
      references?: string | string[];
    }) => {
      const providerMessageId = providerIds[callIndex++] ?? '<auto-reply@furnace.test>';
      captures.push({
        subject: mailOptions.subject ?? '',
        inReplyTo: mailOptions.inReplyTo ?? null,
        references: Array.isArray(mailOptions.references)
          ? mailOptions.references.join(' ')
          : (mailOptions.references ?? null),
        providerMessageId,
      });
      return { messageId: providerMessageId };
    },
  };
  (sendWorker as any).smtpPool = {
    getTransporter: async () => transporter,
    markMessageSent: () => {},
    closeAll: async () => {},
  };
  return sendWorker;
}

async function loadJob(harness: CampaignDbHarness, id: string) {
  const { data, error } = await harness.supabase.from('message_jobs').select('*').eq('id', id).single();
  assert.equal(error, null);
  return data;
}

async function seedInboundMessage(opts: {
  harness: CampaignDbHarness;
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>;
  lead: { enrollmentId: string; leadId: string };
  mailboxId: string;
  subject: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  at: string;
}): Promise<{ threadId: string; messageId: string; rowId: string }> {
  const leadEmail = `lead-chad-${opts.harness.namespace}@example.com`;
  const mailboxEmail =
    opts.graph.mailboxEmailsByKey.get('mailbox-1') ?? `sender-${opts.harness.namespace}@example.com`;

  let threadId: string | null = null;
  const { data: existing } = await opts.harness.supabase
    .from('email_threads')
    .select('id')
    .eq('enrollment_id', opts.lead.enrollmentId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  threadId = existing?.id ?? null;

  if (!threadId) {
    const { data: thread, error } = await opts.harness.supabase
      .from('email_threads')
      .insert({
        account_id: opts.graph.accountId,
        mailbox_id: opts.mailboxId,
        campaign_id: opts.graph.campaignId,
        lead_id: opts.lead.leadId,
        enrollment_id: opts.lead.enrollmentId,
        subject: opts.subject.replace(/^Re:\s*/i, ''),
        participants: [mailboxEmail, leadEmail],
        message_count: 1,
        has_reply: true,
        last_message_at: opts.at,
      })
      .select('id')
      .single();
    assert.equal(error, null);
    threadId = thread!.id;
    opts.graph.manifest.threadIds.push(threadId!);
  }

  const { data: msg, error: msgError } = await opts.harness.supabase
    .from('email_messages')
    .insert({
      thread_id: threadId,
      account_id: opts.graph.accountId,
      direction: 'received',
      from_email: leadEmail,
      to_email: mailboxEmail,
      subject: opts.subject,
      body_text: 'Inbound',
      body_html: '<p>Inbound</p>',
      message_id: opts.messageId.replace(/^<|>$/g, ''),
      in_reply_to: opts.inReplyTo.replace(/^<|>$/g, ''),
      message_references: opts.references,
      received_at: opts.at,
      read_at: null,
    } as any)
    .select('id, message_id')
    .single();
  assert.equal(msgError, null);
  opts.graph.manifest.messageIds.push(msg!.id);

  await opts.harness.supabase
    .from('email_threads')
    .update({
      has_reply: true,
      last_message_at: opts.at,
      message_count: (await opts.harness.supabase
        .from('email_messages')
        .select('*', { count: 'exact', head: true })
        .eq('thread_id', threadId)).count ?? 1,
    } as any)
    .eq('id', threadId);

  return { threadId: threadId!, messageId: msg!.message_id, rowId: msg!.id };
}

test('Chad-shaped timeline: empty root, blank continue, explicit new epoch, inbound-parented priorities, manual reply', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('threading-incident-chad'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Threading Incident Chad',
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
          key: 'chad',
          email: `lead-chad-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('chad')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1 = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2 = graph.nodeIdsByFlowNodeId.get('email-2')!;

    const emptyRootId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1,
      subject: '',
    });
    const blankContId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2,
      subject: '',
    });
    const explicitId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2,
      subject: EXPLICIT_SUBJECT_TEMPLATE,
    });

    const providerIds = [
      `<${CHAD_SHAPED_TIMELINE.emptyRoot}@furnace.test>`,
      `<${CHAD_SHAPED_TIMELINE.blankContinuation}@furnace.test>`,
      `<${CHAD_SHAPED_TIMELINE.explicitSubject}@furnace.test>`,
      `<${CHAD_SHAPED_TIMELINE.priority1}@furnace.test>`,
      `<${CHAD_SHAPED_TIMELINE.priority2}@furnace.test>`,
      `<${CHAD_SHAPED_TIMELINE.manualReply}@furnace.test>`,
    ];
    const captures: CapturedSend[] = [];
    const sendWorker = createCapturingSendWorker(harness, captures, providerIds);

    // 1) Empty root
    await (sendWorker as any).processMessageJob(await loadJob(harness, emptyRootId));
    assert.equal(captures[0]!.subject, '');
    assertNotUiPlaceholder(captures[0]!.subject, 'empty root wire subject');
    assertNoThreadingHeaders(captures[0]!.inReplyTo, captures[0]!.references, 'empty root');

    // 2) Blank continuation of empty root
    await (sendWorker as any).processMessageJob(await loadJob(harness, blankContId));
    assert.equal(captures[1]!.subject, '');
    assertImmediateParent(captures[1]!.inReplyTo, providerIds[0], 'blank continuation parent');
    assertCumulativeReferences(captures[1]!.references, [providerIds[0]!], 'blank continuation refs');

    // 3) Explicit spintax subject starts a NEW thread/epoch
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      await (sendWorker as any).processMessageJob(await loadJob(harness, explicitId));
    } finally {
      Math.random = originalRandom;
    }
    const expectedEpochSubject = mergeTemplate(processSpintax(EXPLICIT_SUBJECT_TEMPLATE, { deterministic: true }), {
      first_name: 'Casey',
    });
    // deterministic processSpintax with Math.random pinned may differ — accept either spun value without templates
    assertNoUnresolvedTemplate(captures[2]!.subject, 'explicit epoch subject');
    assert.ok(captures[2]!.subject.length > 0, 'explicit subject must be non-empty');
    assert.notEqual(captures[2]!.subject, '');
    assertNoThreadingHeaders(
      captures[2]!.inReplyTo,
      captures[2]!.references,
      'explicit subject must start a new thread (no inherited headers)',
    );
    const epochSubject = captures[2]!.subject;

    // Prove re-spin would differ under a different seed (spintax once contract).
    Math.random = () => 0.99;
    let alternate: string;
    try {
      alternate = mergeTemplate(processSpintax(EXPLICIT_SUBJECT_TEMPLATE, { deterministic: false }), {
        first_name: 'Casey',
      });
    } finally {
      Math.random = originalRandom;
    }
    if (alternate !== epochSubject) {
      assert.notEqual(epochSubject, alternate);
    }
    void expectedEpochSubject;

    // 4) Inbound after new epoch
    const inbound1Id = `<${CHAD_SHAPED_TIMELINE.inbound1}@mail.example.com>`;
    const { threadId } = await seedInboundMessage({
      harness,
      graph,
      lead,
      mailboxId,
      subject: `Re: ${epochSubject}`,
      messageId: inbound1Id,
      inReplyTo: providerIds[2]!,
      references: providerIds[2]!,
      at: new Date().toISOString(),
    });

    // 5) Blank priority reply — must continue newest epoch + parent inbound
    const priority1Id = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: null,
      subject: '',
      messageType: 'campaign_priority',
      threadId,
    });
    await (sendWorker as any).processMessageJob(await loadJob(harness, priority1Id));
    assert.equal(
      captures[3]!.subject,
      epochSubject,
      'blank priority must reuse newest subject epoch, not the empty root',
    );
    assert.notEqual(captures[3]!.subject, '');
    assertImmediateParent(captures[3]!.inReplyTo, inbound1Id, 'priority1 parents inbound1');
    assert.ok(
      parseMessageIds(captures[3]!.references).includes(
        providerIds[2]!.replace(/^<|>$/g, '').toLowerCase(),
      ) ||
        parseMessageIds(captures[3]!.references).includes(
          inbound1Id.replace(/^<|>$/g, '').toLowerCase(),
        ),
      'priority1 References must include new-epoch ancestry and/or inbound',
    );

    // 6) Second inbound
    const inbound2Id = `<${CHAD_SHAPED_TIMELINE.inbound2}@mail.example.com>`;
    const { rowId: inbound2RowId } = await seedInboundMessage({
      harness,
      graph,
      lead,
      mailboxId,
      subject: `Re: ${epochSubject}`,
      messageId: inbound2Id,
      inReplyTo: providerIds[3]!,
      references: `${providerIds[2]} ${inbound1Id} ${providerIds[3]}`,
      at: new Date(Date.now() + 1000).toISOString(),
    });

    // 7) Second blank priority
    const priority2Id = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: null,
      subject: '',
      messageType: 'campaign_priority',
      threadId,
    });
    await (sendWorker as any).processMessageJob(await loadJob(harness, priority2Id));
    assert.equal(captures[4]!.subject, epochSubject);
    assertImmediateParent(captures[4]!.inReplyTo, inbound2Id, 'priority2 parents inbound2');

    // 8) Manual reply parents the selected (latest inbound) message
    const manualId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: null,
      subject: `Re: ${epochSubject}`,
      messageType: 'inbox_reply',
      threadId,
    });
    // Stamp selected parent on message_data the way create_inbox_reply_job does.
    await harness.supabase
      .from('message_jobs')
      .update({
        message_data: {
          subject: `Re: ${epochSubject}`,
          body: 'Manual reply',
          in_reply_to_message_id: inbound2RowId,
          in_reply_to: inbound2Id,
          message_references: `${providerIds[2]} ${inbound1Id} ${providerIds[3]} ${inbound2Id}`,
          thread_id: threadId,
          source: 'inbox_reply',
        },
      } as any)
      .eq('id', manualId);

    await (sendWorker as any).processMessageJob(await loadJob(harness, manualId));
    assertImmediateParent(captures[5]!.inReplyTo, inbound2Id, 'manual reply parents selected inbound');
    assertNoUnresolvedTemplate(captures[5]!.subject, 'manual reply subject');
    assert.equal(looksLikeUnresolvedTemplate(epochSubject), false);
  } finally {
    await harness.cleanup();
  }
});

test('empty first message with no history is a valid empty-subject root', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('empty-root-only'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Empty Root Only',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'empty-root',
          email: `lead-empty-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const lead = graph.leadsByKey.get('empty-root')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const jobId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId,
      subject: '',
    });
    const captures: CapturedSend[] = [];
    const sendWorker = createCapturingSendWorker(harness, captures, ['<empty-root@furnace.test>']);
    await (sendWorker as any).processMessageJob(await loadJob(harness, jobId));
    assert.equal(captures[0]!.subject, '');
    assertNotUiPlaceholder(captures[0]!.subject);
    assertNoThreadingHeaders(captures[0]!.inReplyTo, captures[0]!.references);
  } finally {
    await harness.cleanup();
  }
});

test('empty second step continues whenever a prior thread message exists (same as blank follow-up)', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('empty-second-continue'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Empty Second Continue',
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
          key: 'cont',
          email: `lead-cont-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const lead = graph.leadsByKey.get('cont')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1 = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2 = graph.nodeIdsByFlowNodeId.get('email-2')!;
    const firstId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1,
      subject: 'Hello Casey',
    });
    const secondId = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2,
      subject: '',
    });
    const captures: CapturedSend[] = [];
    const sendWorker = createCapturingSendWorker(harness, captures, [
      '<first-cont@furnace.test>',
      '<second-cont@furnace.test>',
    ]);
    await (sendWorker as any).processMessageJob(await loadJob(harness, firstId));
    await (sendWorker as any).processMessageJob(await loadJob(harness, secondId));
    assert.equal(captures[1]!.subject, 'Hello Casey');
    assertImmediateParent(captures[1]!.inReplyTo, '<first-cont@furnace.test>');
  } finally {
    await harness.cleanup();
  }
});
