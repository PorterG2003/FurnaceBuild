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

test('four campaign/priority sends emit immediate-parent and cumulative References', async () => {
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

    const jobIds = [
      await insertReservedJob({
        harness,
        graph,
        lead,
        mailboxId,
        nodeId: email1NodeId,
        subject: 'Root subject Casey',
      }),
      await insertReservedJob({
        harness,
        graph,
        lead,
        mailboxId,
        nodeId: email2NodeId,
        subject: '',
      }),
      await insertReservedJob({
        harness,
        graph,
        lead,
        mailboxId,
        nodeId: null,
        subject: '',
        messageType: 'campaign_priority',
      }),
      await insertReservedJob({
        harness,
        graph,
        lead,
        mailboxId,
        nodeId: email2NodeId,
        subject: '',
      }),
    ];

    const captures: CapturedSend[] = [];
    const providerIds = [
      '<a@furnace.build>',
      '<b@furnace.build>',
      '<c@furnace.build>',
      '<d@furnace.build>',
    ];
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

    // Seed a thread for priority job recording (optional); paced sends don't require it.
    for (const jobId of jobIds) {
      const { data: job } = await harness.supabase.from('message_jobs').select('*').eq('id', jobId).single();
      await (sendWorker as any).processMessageJob(job);
    }

    assert.equal(captures.length, 4);
    assert.equal(captures[0]!.inReplyTo, null);
    assert.equal(captures[0]!.references, null);
    assert.equal(captures[0]!.subject, 'Root subject Casey');

    assert.equal(captures[1]!.subject, 'Root subject Casey');
    assert.equal(captures[1]!.inReplyTo, '<a@furnace.build>');
    assert.deepEqual(parseMessageIds(captures[1]!.references), ['a@furnace.build']);

    assert.equal(captures[2]!.subject, 'Root subject Casey');
    assert.equal(captures[2]!.inReplyTo, '<b@furnace.build>');
    assert.deepEqual(parseMessageIds(captures[2]!.references), [
      'a@furnace.build',
      'b@furnace.build',
    ]);

    assert.equal(captures[3]!.subject, 'Root subject Casey');
    assert.equal(captures[3]!.inReplyTo, '<c@furnace.build>');
    assert.deepEqual(parseMessageIds(captures[3]!.references), [
      'a@furnace.build',
      'b@furnace.build',
      'c@furnace.build',
    ]);

    const { data: jobs } = await harness.supabase
      .from('message_jobs')
      .select('id, provider_message_id, submitted_message_id, message_data')
      .in('id', jobIds)
      .order('sent_at', { ascending: true });
    assert.equal(jobs?.length, 4);
    for (const job of jobs ?? []) {
      assert.ok((job as any).submitted_message_id || (job as any).message_data?.submitted_message_id);
      assert.ok((job as any).provider_message_id);
    }
  } finally {
    await harness.cleanup();
  }
});
