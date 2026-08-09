import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseMessageIds } from '../../email/threadHeaders.js';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { SendWorker } from '../../../workers/send-worker/src/worker';
import {
  assertCumulativeReferences,
  assertImmediateParent,
} from '../inbox/threadingAssertions';

type CapturedSend = {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
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

async function insertInbound(opts: {
  harness: CampaignDbHarness;
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>;
  lead: { enrollmentId: string; leadId: string };
  mailboxId: string;
  threadId: string;
  messageId: string;
  inReplyTo: string;
  at: string;
}) {
  const leadEmail = `lead-chain-${opts.harness.namespace}@example.com`;
  const mailboxEmail =
    opts.graph.mailboxEmailsByKey.get('mailbox-1') ?? `sender-${opts.harness.namespace}@example.com`;
  const { data, error } = await opts.harness.supabase
    .from('email_messages')
    .insert({
      thread_id: opts.threadId,
      account_id: opts.graph.accountId,
      direction: 'received',
      from_email: leadEmail,
      to_email: mailboxEmail,
      subject: 'Re: Root subject Casey',
      body_text: 'Inbound',
      body_html: '<p>Inbound</p>',
      message_id: opts.messageId.replace(/^<|>$/g, ''),
      in_reply_to: opts.inReplyTo.replace(/^<|>$/g, ''),
      message_references: opts.inReplyTo,
      received_at: opts.at,
    } as any)
    .select('id')
    .single();
  assert.equal(error, null);
  opts.graph.manifest.messageIds.push(data!.id);
}

test('mixed outbound/inbound chain: each send parents the most recent thread message', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('threading-chain'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Threading Chain Outcomes',
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
          key: 'chain-lead',
          email: `lead-chain-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('chain-lead')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const email1NodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const email2NodeId = graph.nodeIdsByFlowNodeId.get('email-2')!;
    const leadEmail = `lead-chain-${harness.namespace}@example.com`;
    const mailboxEmail =
      graph.mailboxEmailsByKey.get('mailbox-1') ?? `sender-${harness.namespace}@example.com`;

    const { data: thread, error: threadError } = await harness.supabase
      .from('email_threads')
      .insert({
        account_id: graph.accountId,
        mailbox_id: mailboxId,
        campaign_id: graph.campaignId,
        lead_id: lead.leadId,
        enrollment_id: lead.enrollmentId,
        subject: 'Root subject Casey',
        participants: [mailboxEmail, leadEmail],
        message_count: 1,
        has_reply: false,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    assert.equal(threadError, null);
    graph.manifest.threadIds.push(thread!.id);

    const jobRoot = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email1NodeId,
      subject: 'Root subject Casey',
    });
    const jobFollow = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: '',
    });
    const jobPriority = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: null,
      subject: '',
      messageType: 'campaign_priority',
      threadId: thread!.id,
    });
    const jobAfter = await insertReservedJob({
      harness,
      graph,
      lead,
      mailboxId,
      nodeId: email2NodeId,
      subject: '',
    });

    const captures: CapturedSend[] = [];
    const providerIds = [
      '<a@furnace.build>',
      '<b@furnace.build>',
      '<c@furnace.build>',
      '<d@furnace.build>',
    ];
    const inboundId = '<inbound-1@mail.example.com>';
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
        captures.push({ subject, inReplyTo: inReplyTo ?? null, references: references ?? null });
        const providerMessageId = providerIds[callIndex++]!;
        return {
          submittedMessageId: `<${job.id}@furnace.build>`,
          providerMessageId,
        };
      },
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    // Root outbound
    await (sendWorker as any).processMessageJob(
      (await harness.supabase.from('message_jobs').select('*').eq('id', jobRoot).single()).data,
    );
    assert.equal(captures[0]!.inReplyTo, null);
    assert.equal(captures[0]!.subject, 'Root subject Casey');

    // Blank follow-up parents root outbound
    await (sendWorker as any).processMessageJob(
      (await harness.supabase.from('message_jobs').select('*').eq('id', jobFollow).single()).data,
    );
    assertImmediateParent(captures[1]!.inReplyTo, providerIds[0]);
    assertCumulativeReferences(captures[1]!.references, [providerIds[0]]);

    // Inbound arrives — becomes the most recent thread message
    await insertInbound({
      harness,
      graph,
      lead,
      mailboxId,
      threadId: thread!.id,
      messageId: inboundId,
      inReplyTo: providerIds[1]!,
      at: new Date().toISOString(),
    });

    // Priority must parent the inbound (causal), not outbound B
    await (sendWorker as any).processMessageJob(
      (await harness.supabase.from('message_jobs').select('*').eq('id', jobPriority).single()).data,
    );
    assert.equal(captures[2]!.subject, 'Root subject Casey');
    assertImmediateParent(
      captures[2]!.inReplyTo,
      inboundId,
      'priority after inbound must parent the inbound Message-ID',
    );
    assert.ok(
      parseMessageIds(captures[2]!.references).includes('inbound-1@mail.example.com') ||
        parseMessageIds(captures[2]!.references).includes('b@furnace.build'),
      'References must include inbound ancestry',
    );

    // Another blank after priority parents priority outbound C (latest)
    await (sendWorker as any).processMessageJob(
      (await harness.supabase.from('message_jobs').select('*').eq('id', jobAfter).single()).data,
    );
    assertImmediateParent(captures[3]!.inReplyTo, providerIds[2]);
  } finally {
    await harness.cleanup();
  }
});
