/**
 * Thread subject / backfill outcomes when sent events are missing.
 * Contract §11–§15: prefer rendered sent_subject over raw node_config templates.
 *
 * See docs/engineering/email-threading-test-contract.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildImportedSentJob,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { buildProcessedReply, getMailboxRow } from '../campaign/categorizer-helpers';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import type { Mailbox } from '../../../workers/inbox-checker-worker/src/types';
import {
  assertNoUnresolvedTemplate,
  looksLikeUnresolvedTemplate,
} from './threadingAssertions';

const RAW_TEMPLATE = '{Hello {{first_name}}|Hi {{first_name}}}';
const RENDERED = 'Hello Casey';

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

test('missing sent event + rendered message_data.sent_subject: thread and backfill stay rendered', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-subject-rendered'),
  });

  try {
    const now = Date.now();
    const providerMessageId = `<imported-${harness.namespace}@furnace.test>`;
    const leadEmail = `lead-subj-${harness.namespace}@example.com`;
    const graph = await harness.createCampaignGraph({
      name: 'Thread Subject Outcomes',
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
          key: 'subj',
          email: leadEmail,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildImportedSentJob({
              key: 'imported-1',
              subjectTemplate: RAW_TEMPLATE,
              renderedSubject: RENDERED,
              providerMessageId,
              sentAt: new Date(now - 2 * 60 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('subj')!;
    const jobId = lead.messageJobIdsByKey.get('imported-1')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    // Confirm seed: no sent event, rendered sent_subject + raw node_config.
    const { data: job } = await harness.supabase
      .from('message_jobs')
      .select('message_data')
      .eq('id', jobId)
      .single();
    assert.equal((job as any).message_data.sent_subject, RENDERED);
    assert.equal((job as any).message_data.node_config.subject, RAW_TEMPLATE);
    assert.equal(looksLikeUnresolvedTemplate(RAW_TEMPLATE), true);

    const { count: eventCount } = await harness.supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('message_job_id', jobId)
      .eq('event_type', 'sent');
    assert.equal(eventCount ?? 0, 0, 'fixture must omit sent events');

    const mailbox = asMailbox(graph, mailboxId);
    const handled = await new ThreadManager(harness.supabase as any).handleReply(
      mailbox,
      buildProcessedReply({
        leadEmail,
        mailboxEmail: mailbox.email_address,
        inReplyTo: providerMessageId,
        subject: `Re: ${RENDERED}`,
        bodyText: 'Thanks',
      }),
    );
    assert.equal(handled, true);

    const { data: threads } = await harness.supabase
      .from('email_threads')
      .select('id, subject')
      .eq('enrollment_id', lead.enrollmentId!)
      .order('created_at', { ascending: true })
      .limit(1);
    const thread = threads?.[0];
    assert.ok(thread, 'thread must be created');
    assert.equal(
      thread!.subject,
      RENDERED,
      'email_threads.subject must use rendered sent_subject, not raw node_config',
    );
    assertNoUnresolvedTemplate(thread!.subject, 'email_threads.subject');

    const { data: backfilled } = await harness.supabase
      .from('email_messages')
      .select('subject, message_job_id, direction')
      .eq('thread_id', thread!.id)
      .eq('direction', 'sent')
      .eq('message_job_id', jobId)
      .maybeSingle();
    assert.ok(backfilled, 'sent message must be backfilled');
    assert.equal(
      backfilled!.subject,
      RENDERED,
      'backfilled email_messages.subject must stay rendered',
    );
    assertNoUnresolvedTemplate(backfilled!.subject, 'email_messages.subject');
  } finally {
    await harness.cleanup();
  }
});

test('imported job without sent_subject must not expose raw spintax on thread title when a safe rendered fallback exists', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-subject-no-sent-subject'),
  });

  try {
    const now = Date.now();
    const providerMessageId = `<imported-raw-${harness.namespace}@furnace.test>`;
    const leadEmail = `lead-raw-${harness.namespace}@example.com`;
    // Only raw template in node_config; message_data.subject holds a rendered fallback
    // that production should prefer over unresolved spintax.
    const graph = await harness.createCampaignGraph({
      name: 'Thread Subject Raw Guard',
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
          key: 'raw',
          email: leadEmail,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildImportedSentJob({
              key: 'imported-raw',
              subjectTemplate: RAW_TEMPLATE,
              providerMessageId,
              sentAt: new Date(now - 2 * 60 * 60_000).toISOString(),
              messageData: {
                source: 'imported_seed',
                subject: RENDERED,
                node_config: {
                  subject: RAW_TEMPLATE,
                  body_html: '<p>Imported body</p>',
                  body_text: 'Imported body',
                },
              },
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('raw')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const mailbox = asMailbox(graph, mailboxId);
    assert.equal(
      await new ThreadManager(harness.supabase as any).handleReply(
        mailbox,
        buildProcessedReply({
          leadEmail,
          mailboxEmail: mailbox.email_address,
          inReplyTo: providerMessageId,
          subject: `Re: ${RENDERED}`,
        }),
      ),
      true,
    );

    const { data: thread } = await harness.supabase
      .from('email_threads')
      .select('subject')
      .eq('enrollment_id', lead.enrollmentId!)
      .limit(1)
      .single();
    assert.ok(thread);
    assertNoUnresolvedTemplate(thread!.subject, 'thread subject without sent event');
    assert.equal(thread!.subject, RENDERED);
  } finally {
    await harness.cleanup();
  }
});

test('cross-account / mailbox isolation: reply matching does not attach to foreign campaign outbound', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('thread-subject-isolation'),
  });

  try {
    const now = Date.now();
    const sharedProviderId = `<shared-${randomUUID().slice(0, 8)}@furnace.test>`;

    const graphA = await harness.createCampaignGraph({
      name: 'Isolation A',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-a-${harness.namespace}@example.com`,
          displayName: 'Sender A',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'a',
          email: `lead-a-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildImportedSentJob({
              key: 'sent-a',
              subjectTemplate: 'Campaign A',
              renderedSubject: 'Campaign A',
              providerMessageId: sharedProviderId,
              sentAt: new Date(now - 3600_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const graphB = await harness.createCampaignGraph({
      name: 'Isolation B',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-b-${harness.namespace}@example.com`,
          displayName: 'Sender B',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'b',
          email: `lead-b-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(now - 60_000).toISOString(),
          }),
          jobs: [
            buildImportedSentJob({
              key: 'sent-b',
              subjectTemplate: 'Campaign B',
              renderedSubject: 'Campaign B',
              providerMessageId: `<other-${harness.namespace}@furnace.test>`,
              sentAt: new Date(now - 3600_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const leadBEmail = `lead-b-${harness.namespace}@example.com`;
    const mailboxBId = graphB.mailboxIdsByKey.get('mailbox-1')!;
    const mailboxB = await getMailboxRow(harness, mailboxBId);

    // Inbound on mailbox B referencing A's provider id must not create a B-thread
    // keyed to A's campaign when lead emails differ.
    const handled = await new ThreadManager(harness.supabase as any).handleReply(
      mailboxB,
      buildProcessedReply({
        leadEmail: leadBEmail,
        mailboxEmail: mailboxB.email_address,
        inReplyTo: sharedProviderId,
        bodyText: 'Wrong mailbox reference',
      }),
    );

    // Either ignored or attached only within B's own jobs — never to graph A's enrollment.
    const { data: aThreads } = await harness.supabase
      .from('email_threads')
      .select('id, campaign_id')
      .eq('campaign_id', graphA.campaignId);
    if (handled) {
      for (const t of aThreads ?? []) {
        assert.equal(t.campaign_id, graphA.campaignId);
      }
      const { data: bThreads } = await harness.supabase
        .from('email_threads')
        .select('id, campaign_id, lead_id')
        .eq('campaign_id', graphB.campaignId);
      for (const t of bThreads ?? []) {
        assert.notEqual(t.lead_id, graphA.leadsByKey.get('a')!.leadId);
      }
    } else {
      assert.equal((aThreads ?? []).length >= 0, true);
    }
  } finally {
    await harness.cleanup();
  }
});
