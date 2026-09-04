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
import { OPEN_CONVERSATION_COUNT_FILTERS } from '../../supabase/services/inbox/openConversationCounts-core';

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

async function countOpenConversationsWithReply(
  harness: CampaignDbHarness,
  accountId: string,
  campaignId: string,
): Promise<number> {
  const { count, error } = await harness.supabase
    .from('email_threads')
    .select(OPEN_CONVERSATION_COUNT_FILTERS.countColumn, { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('conversation_status', OPEN_CONVERSATION_COUNT_FILTERS.conversationStatus)
    .eq('has_reply', OPEN_CONVERSATION_COUNT_FILTERS.hasReply);
  assert.equal(error, null, error?.message);
  return count ?? 0;
}

async function listInboxThreadIds(
  harness: CampaignDbHarness,
  accountId: string,
  campaignId: string,
): Promise<string[]> {
  const { data, error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: accountId,
    p_campaign_ids: [campaignId],
    p_has_reply_only: true,
    p_limit: 20,
    p_offset: 0,
  });
  assert.equal(error, null, error?.message);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function skipIfInboxListRpcMissing(
  harness: CampaignDbHarness,
  t: { skip: (reason?: string) => void },
): Promise<boolean> {
  const { error } = await harness.supabase.rpc('list_account_inbox_threads', {
    p_account_id: '00000000-0000-4000-8000-000000000000',
    p_has_reply_only: true,
    p_limit: 1,
    p_offset: 0,
  });
  if (
    error &&
    /Could not find the function|does not exist|schema cache/i.test(error.message)
  ) {
    t.skip(`list_account_inbox_threads not applied: ${error.message}`);
    return true;
  }
  return false;
}

test('lazy-create human reply stamps has_reply and is listable as open', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-ingest-human-stamp'),
  });

  try {
    if (await skipIfSentJobLookupRpcMissing(harness, t)) return;
    if (await skipIfInboxListRpcMissing(harness, t)) return;

    const graph = await harness.createCampaignGraph({
      name: 'Lazy Human Reply Stamp',
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
          email: `lead-human-${harness.namespace}@example.com`,
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
    const leadEmail = `lead-human-${harness.namespace}@example.com`;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const providerId = `<root-human-${harness.namespace}@furnace.build>`;
    await seedSentJob({
      harness,
      graph,
      lead,
      mailboxId,
      providerMessageId: providerId,
    });

    const mailbox = asMailbox(graph, mailboxId);
    const inboundAt = new Date('2026-09-03T20:44:33.000Z');
    const manager = new ThreadManager(harness.supabase as any);
    const handled = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: providerId,
        subject: 'Re: Quick check-in',
        date: inboundAt,
      }),
    );
    assert.equal(handled, true);

    const { data: receivedRows, error: receivedError } = await harness.supabase
      .from('email_messages')
      .select('id, thread_id, received_at')
      .eq('account_id', graph.accountId)
      .eq('direction', 'received')
      .eq('from_email', leadEmail);
    assert.equal(receivedError, null, receivedError?.message);
    assert.equal(receivedRows?.length, 1);
    const threadId = receivedRows![0]!.thread_id as string;
    graph.manifest.threadIds.push(threadId);
    graph.manifest.messageIds.push(receivedRows![0]!.id as string);

    const { count: messageCount, error: countError } = await harness.supabase
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    assert.equal(countError, null, countError?.message);

    const { data: thread, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('has_reply, last_inbound_at, message_count, conversation_status')
      .eq('id', threadId)
      .single();
    assert.equal(threadError, null, threadError?.message);
    assert.equal(thread?.has_reply, true);
    assert.equal(thread?.last_inbound_at, receivedRows![0]!.received_at);
    assert.equal(thread?.message_count, messageCount);
    assert.equal(thread?.conversation_status, 'open');

    const listed = await listInboxThreadIds(harness, graph.accountId, graph.campaignId);
    assert.ok(listed.includes(threadId), `expected ${threadId} in inbox list, got ${listed.join(',')}`);
    assert.equal(await countOpenConversationsWithReply(harness, graph.accountId, graph.campaignId), 1);
  } finally {
    await harness.cleanup();
  }
});

test('lazy-create header auto-reply stamps has_reply and closes as Auto Reply', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-ingest-ooo-stamp'),
  });

  try {
    if (await skipIfSentJobLookupRpcMissing(harness, t)) return;
    if (await skipIfInboxListRpcMissing(harness, t)) return;

    const graph = await harness.createCampaignGraph({
      name: 'Lazy Auto Reply Stamp',
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
          email: `lead-ooo-${harness.namespace}@example.com`,
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
    const leadEmail = `lead-ooo-${harness.namespace}@example.com`;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const providerId = `<root-ooo-${harness.namespace}@furnace.build>`;
    await seedSentJob({
      harness,
      graph,
      lead,
      mailboxId,
      providerMessageId: providerId,
    });

    const mailbox = asMailbox(graph, mailboxId);
    const inboundAt = new Date('2026-09-03T20:44:33.000Z');
    const manager = new ThreadManager(harness.supabase as any);
    const handled = await manager.handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: providerId,
        subject: 'Re: Quick check-in',
        date: inboundAt,
        autoReply: true,
      }),
    );
    assert.equal(handled, true);

    const { data: receivedRows, error: receivedError } = await harness.supabase
      .from('email_messages')
      .select('id, thread_id, received_at')
      .eq('account_id', graph.accountId)
      .eq('direction', 'received')
      .eq('from_email', leadEmail);
    assert.equal(receivedError, null, receivedError?.message);
    assert.equal(receivedRows?.length, 1);
    const threadId = receivedRows![0]!.thread_id as string;
    graph.manifest.threadIds.push(threadId);
    graph.manifest.messageIds.push(receivedRows![0]!.id as string);

    const { count: messageCount, error: countError } = await harness.supabase
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    assert.equal(countError, null, countError?.message);

    const { data: thread, error: threadError } = await harness.supabase
      .from('email_threads')
      .select(
        'has_reply, last_inbound_at, message_count, conversation_status, category, category_source',
      )
      .eq('id', threadId)
      .single();
    assert.equal(threadError, null, threadError?.message);
    assert.equal(thread?.has_reply, true);
    assert.equal(thread?.last_inbound_at, receivedRows![0]!.received_at);
    assert.equal(thread?.message_count, messageCount);
    assert.equal(thread?.conversation_status, 'closed');
    assert.equal(thread?.category, 'Auto Reply');
    assert.equal(thread?.category_source, 'system');

    const listed = await listInboxThreadIds(harness, graph.accountId, graph.campaignId);
    assert.ok(listed.includes(threadId), `expected ${threadId} in inbox list, got ${listed.join(',')}`);
    assert.equal(await countOpenConversationsWithReply(harness, graph.accountId, graph.campaignId), 0);
  } finally {
    await harness.cleanup();
  }
});
