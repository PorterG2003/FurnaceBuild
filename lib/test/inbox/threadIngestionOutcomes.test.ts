import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { buildProcessedReply } from '../campaign/categorizer-helpers';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import type { Mailbox } from '../../../workers/inbox-checker-worker/src/types';

function isMissingSentJobLookupRpc(message: string | undefined): boolean {
  return !!message && /could not find|schema cache|does not exist|PGRST202/i.test(message);
}

async function skipIfSentJobLookupRpcMissing(
  harness: CampaignDbHarness,
  t: { skip: (reason?: string) => void },
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('find_sent_jobs_by_message_ids', {
    p_account_id: '00000000-0000-0000-0000-000000000000',
    p_search_ids: ['nobody@example.com'],
    p_limit: 1,
  });
  if (error && isMissingSentJobLookupRpc(error.message)) {
    t.skip(`find_sent_jobs_by_message_ids not applied: ${error.message}`);
    return true;
  }
  return false;
}

async function seedSentJob(opts: {
  harness: CampaignDbHarness;
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>;
  lead: { enrollmentId: string; leadId: string };
  mailboxId: string;
  providerMessageId: string;
  submittedMessageId?: string;
  subject?: string;
}) {
  const messageJobId = randomUUID();
  const sentAt = new Date().toISOString();
  const { error } = await opts.harness.supabase.from('message_jobs').insert({
    id: messageJobId,
    enrollment_id: opts.lead.enrollmentId,
    campaign_id: opts.graph.campaignId,
    account_id: opts.graph.accountId,
    lead_id: opts.lead.leadId,
    mailbox_id: opts.mailboxId,
    node_id: opts.graph.nodeIdsByFlowNodeId.get('email-1')!,
    status: 'sent',
    scheduled_at: sentAt,
    reserved_at: sentAt,
    sent_at: sentAt,
    provider_message_id: opts.providerMessageId,
    submitted_message_id: opts.submittedMessageId ?? opts.providerMessageId,
    error_message: null,
    retry_count: 0,
    message_type: 'campaign',
    message_data: {
      sent_subject: opts.subject ?? 'Quick check-in',
      node_config: { subject: opts.subject ?? 'Quick check-in', body_html: '<p>Hi</p>', body_text: 'Hi' },
    },
  } as any);
  assert.equal(error, null);
  opts.graph.manifest.messageJobIds.push(messageJobId);
  return messageJobId;
}

function asMailbox(
  graph: Awaited<ReturnType<CampaignDbHarness['createCampaignGraph']>>,
  mailboxId: string,
): Mailbox {
  const emailAddress =
    graph.mailboxEmailsByKey.get('mailbox-1') ?? `sender-${mailboxId.slice(0, 8)}@example.com`;
  return {
    id: mailboxId,
    account_id: graph.accountId,
    user_id: 'test-user',
    email_address: emailAddress,
    display_name: 'Sender',
    provider: 'custom',
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_username: 'u',
    smtp_password: 'p',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_username: 'u',
    imap_password: 'p',
    imap_use_ssl: true,
    status: 'connected',
    last_synced_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('exact In-Reply-To attaches once; unrelated inbound is ignored', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-ingest'),
  });

  try {
    if (await skipIfSentJobLookupRpcMissing(harness, t)) return;

    const graph = await harness.createCampaignGraph({
      name: 'Thread Ingestion Outcomes',
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
          key: 'ingest-lead',
          email: `lead-ingest-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const lead = graph.leadsByKey.get('ingest-lead')!;
    const leadEmail = `lead-ingest-${harness.namespace}@example.com`;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const providerId = `<root-${harness.namespace}@furnace.build>`;
    const submittedId = `<submitted-${harness.namespace}@furnace.build>`;
    await seedSentJob({
      harness,
      graph,
      lead,
      mailboxId,
      providerMessageId: providerId,
      submittedMessageId: submittedId,
    });

    const mailbox = asMailbox(graph, mailboxId);
    const manager = new ThreadManager(harness.supabase as any);

    const handled = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: providerId,
        subject: 'Re: Quick check-in',
      }),
    );
    assert.equal(handled, true);

    const { data: receivedRows } = await harness.supabase
      .from('email_messages')
      .select('id, thread_id')
      .eq('account_id', graph.accountId)
      .eq('direction', 'received')
      .eq('from_email', leadEmail);
    assert.equal(receivedRows?.length, 1);
    const threadId = receivedRows![0]!.thread_id as string;
    graph.manifest.threadIds.push(threadId);
    for (const row of receivedRows ?? []) {
      graph.manifest.messageIds.push(row.id as string);
    }

    // References-only (Outlook-style): attach via Furnace ID in References
    const handledRefs = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: '<external@outlook.com>',
        references: `${providerId} <external@outlook.com>`,
        subject: 'Re: Quick check-in',
      }),
    );
    // May be duplicate thread attach of second reply - should still handle
    assert.equal(handledRefs, true);

    // Provider alias: reply citing submitted ID (after exact match already attached)
    const handledAlias = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: submittedId,
        subject: 'Re: Quick check-in',
      }),
    );
    assert.equal(handledAlias, true, 'submitted_message_id alias should match outbound job');

    // Unrelated newsletter: ignore
    const newsletterFrom = `newsletter-${harness.namespace}@cold.example`;
    const ignored = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail: newsletterFrom,
        mailboxEmail: mailbox.email_address,
        inReplyTo: '<totally-unknown@other.com>',
        references: '<also-unknown@other.com>',
        subject: 'Weekly digest',
      }),
    );
    assert.equal(ignored, false);

    const { data: afterIgnore } = await harness.supabase
      .from('email_messages')
      .select('id')
      .eq('account_id', graph.accountId)
      .eq('direction', 'received')
      .eq('from_email', newsletterFrom);
    assert.equal(afterIgnore?.length ?? 0, 0);
  } finally {
    await harness.cleanup();
  }
});

test('find_sent_jobs_by_message_ids matches provider-only and submitted-only jobs', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('msgid-rpc-union'),
  });

  try {
    if (await skipIfSentJobLookupRpcMissing(harness, t)) return;

    const graph = await harness.createCampaignGraph({
      name: 'Sent Job Lookup Union',
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
          key: 'provider-lead',
          email: `lead-provider-${harness.namespace}@example.com`,
          firstName: 'Pat',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
        buildCampaignLead({
          key: 'submitted-lead',
          email: `lead-submitted-${harness.namespace}@example.com`,
          firstName: 'Sam',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const providerLead = graph.leadsByKey.get('provider-lead')!;
    const submittedLead = graph.leadsByKey.get('submitted-lead')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const providerOnlyId = `<provider-only-${harness.namespace}@furnace.build>`;
    const submittedOnlyId = `<submitted-only-${harness.namespace}@furnace.build>`;

    const providerJobId = await seedSentJob({
      harness,
      graph,
      lead: providerLead,
      mailboxId,
      providerMessageId: providerOnlyId,
      submittedMessageId: `<unrelated-sub-${harness.namespace}@furnace.build>`,
    });
    const submittedJobId = await seedSentJob({
      harness,
      graph,
      lead: submittedLead,
      mailboxId,
      providerMessageId: `<unrelated-prov-${harness.namespace}@furnace.build>`,
      submittedMessageId: submittedOnlyId,
    });

    const { data: byProvider, error: providerError } = await harness.supabase.rpc(
      'find_sent_jobs_by_message_ids',
      {
        p_account_id: graph.accountId,
        p_search_ids: [providerOnlyId],
        p_limit: 40,
      },
    );
    assert.equal(providerError, null, providerError?.message);
    assert.equal(byProvider?.length, 1);
    assert.equal(byProvider![0]!.id, providerJobId);

    const { data: bySubmitted, error: submittedError } = await harness.supabase.rpc(
      'find_sent_jobs_by_message_ids',
      {
        p_account_id: graph.accountId,
        p_search_ids: [submittedOnlyId],
        p_limit: 40,
      },
    );
    assert.equal(submittedError, null, submittedError?.message);
    assert.equal(bySubmitted?.length, 1);
    assert.equal(bySubmitted![0]!.id, submittedJobId);

    const { data: emptyIds, error: emptyError } = await harness.supabase.rpc(
      'find_sent_jobs_by_message_ids',
      {
        p_account_id: graph.accountId,
        p_search_ids: [],
        p_limit: 40,
      },
    );
    assert.equal(emptyError, null, emptyError?.message);
    assert.equal(emptyIds?.length ?? 0, 0);
  } finally {
    await harness.cleanup();
  }
});

test('inbound reply persists multi-To and Cc on the final email_messages row', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-ingest-recipients'),
  });

  try {
    const { error: schemaProbeError } = await harness.supabase
      .from('email_messages')
      .select('to_emails')
      .limit(1);
    if (
      schemaProbeError &&
      /to_emails|schema cache|column/i.test(schemaProbeError.message)
    ) {
      t.skip(`email_messages.to_emails not applied in shared test DB: ${schemaProbeError.message}`);
      return;
    }

    if (await skipIfSentJobLookupRpcMissing(harness, t)) return;

    const graph = await harness.createCampaignGraph({
      name: 'Thread Ingestion Recipients',
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
          key: 'ingest-lead',
          email: `lead-recipients-${harness.namespace}@example.com`,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });
    const lead = graph.leadsByKey.get('ingest-lead')!;
    const leadEmail = `lead-recipients-${harness.namespace}@example.com`;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const providerId = `<root-recipients-${harness.namespace}@furnace.build>`;
    await seedSentJob({
      harness,
      graph,
      lead,
      mailboxId,
      providerMessageId: providerId,
    });

    const mailbox = asMailbox(graph, mailboxId);
    const secondaryTo = `also-${harness.namespace}@example.com`;
    const ccAddress = `cc-${harness.namespace}@example.com`;
    const manager = new ThreadManager(harness.supabase as any);
    const handled = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: providerId,
        subject: 'Re: Quick check-in',
        to: [
          { address: mailbox.email_address, name: 'Sender' },
          { address: secondaryTo, name: 'Also' },
        ],
        cc: [{ address: ccAddress, name: 'Cc' }],
      }),
    );
    assert.equal(handled, true);

    const { data: receivedRows, error } = await harness.supabase
      .from('email_messages')
      .select('id, thread_id, to_email, to_emails, cc')
      .eq('account_id', graph.accountId)
      .eq('direction', 'received')
      .eq('from_email', leadEmail);
    assert.equal(error, null, error?.message);
    assert.equal(receivedRows?.length, 1);
    const row = receivedRows![0]!;
    graph.manifest.threadIds.push(row.thread_id as string);
    graph.manifest.messageIds.push(row.id as string);

    assert.equal(row.to_email, mailbox.email_address);
    assert.deepEqual(row.to_emails, [mailbox.email_address, secondaryTo]);
    assert.deepEqual(row.cc, [ccAddress]);

    const { data: threadRow, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('participants')
      .eq('id', row.thread_id)
      .single();
    assert.equal(threadError, null, threadError?.message);
    const participants = (threadRow?.participants ?? []) as string[];
    const normalized = participants.map((email) => email.toLowerCase());
    assert.equal(new Set(normalized).size, normalized.length);
    assert.ok(normalized.includes(leadEmail.toLowerCase()));
    assert.ok(normalized.includes(mailbox.email_address.toLowerCase()));
    assert.ok(normalized.includes(secondaryTo.toLowerCase()));
    assert.ok(normalized.includes(ccAddress.toLowerCase()));
  } finally {
    await harness.cleanup();
  }
});
