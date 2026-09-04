import assert from 'node:assert/strict';
import test from 'node:test';
import type { SQSEvent } from 'aws-lambda';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';
import { buildProcessedReply } from '../campaign/categorizer-helpers';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager';
import { handler as classifyReplyHandler } from '../../../amplify/functions/classifyReply/handler';

async function ensureInboxRedesignSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase
    .from('email_threads')
    .select('conversation_status, classification_status, handling_metadata')
    .limit(1);
  if (error) {
    t.skip(`Inbox redesign schema not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function getMailbox(harness: CampaignDbHarness, mailboxId: string) {
  const { data, error } = await harness.supabase
    .from('mailboxes')
    .select('*')
    .eq('id', mailboxId)
    .single();
  assert.equal(error, null);
  return data as any;
}

async function getLatestReceivedMessageId(harness: CampaignDbHarness, threadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('email_messages')
    .select('id')
    .eq('thread_id', threadId)
    .eq('direction', 'received')
    .order('received_at', { ascending: false })
    .limit(1);
  assert.equal(error, null);
  assert.ok(data?.[0]?.id);
  return data[0].id as string;
}

async function getThread(harness: CampaignDbHarness, threadId: string) {
  const { data, error } = await harness.supabase
    .from('email_threads')
    .select('*')
    .eq('id', threadId)
    .single();
  assert.equal(error, null);
  return data as any;
}

async function deliverReply(params: {
  harness: CampaignDbHarness;
  threadId: string;
  mailboxId: string;
  mailboxEmail: string;
  leadEmail: string;
  providerMessageId: string;
  bodyText: string;
  autoReply?: boolean;
}) {
  const mailbox = await getMailbox(params.harness, params.mailboxId);
  const threadManager = new ThreadManager(params.harness.supabase as any);
  const handled = await threadManager.handleReply(
    mailbox,
    buildProcessedReply({
      leadEmail: params.leadEmail,
      mailboxEmail: params.mailboxEmail,
      inReplyTo: params.providerMessageId,
      bodyText: params.bodyText,
      autoReply: params.autoReply,
    }),
  );
  assert.equal(handled, true);
  return getThread(params.harness, params.threadId);
}

function makeSqsEvent(payload: Record<string, unknown>): SQSEvent {
  return {
    Records: [
      {
        messageId: 'msg-1',
        receiptHandle: 'receipt',
        body: JSON.stringify(payload),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: `${Date.now()}`,
          SenderId: 'tester',
          ApproximateFirstReceiveTimestamp: `${Date.now()}`,
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:test',
        awsRegion: 'us-west-2',
      },
    ],
  };
}

test('manual close preserves category and a new inbound reply reopens the thread', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('conversation-reopen') });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    const graph = await harness.createCampaignGraph({
      name: 'Conversation Reopen',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: Reopen me',
            category: 'Neutral',
            categorySource: 'user',
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const threadId = lead.threadId!;
    const sentJobId = lead.messageJobIdsByKey.get('sent-1')!;
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('provider_message_id, mailbox_id')
      .eq('id', sentJobId)
      .single();
    assert.ok(sentJob?.provider_message_id);

    const { error: closeError } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'closed',
        conversation_status_source: 'user',
      })
      .eq('id', threadId);
    assert.equal(closeError, null);

    const closedThread = await getThread(harness, threadId);
    assert.equal(closedThread.category, 'Neutral');
    assert.equal(closedThread.conversation_status, 'closed');
    assert.equal(closedThread.conversation_status_source, 'user');

    const reopenedThread = await deliverReply({
      harness,
      threadId,
      mailboxId: sentJob!.mailbox_id,
      mailboxEmail: graph.mailboxEmailsByKey.get('mailbox-1')!,
      leadEmail: `lead-${harness.namespace}@furnace.test`,
      providerMessageId: sentJob!.provider_message_id,
      bodyText: 'Following up with a human reply.',
    });

    assert.equal(reopenedThread.category, 'Neutral');
    assert.equal(reopenedThread.conversation_status, 'open');
    assert.equal(reopenedThread.conversation_status_source, 'system');
    assert.equal(reopenedThread.classification_status, 'pending');
  } finally {
    await harness.cleanup();
  }
});

test('header-detected auto replies auto-close and a later human reply reopens and clears machine Auto Reply', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('conversation-autoreply') });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    const graph = await harness.createCampaignGraph({
      name: 'Conversation Auto Reply',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: Vacation responder',
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const threadId = lead.threadId!;
    const sentJobId = lead.messageJobIdsByKey.get('sent-1')!;
    const { data: sentJob } = await harness.supabase
      .from('message_jobs')
      .select('provider_message_id, mailbox_id')
      .eq('id', sentJobId)
      .single();
    assert.ok(sentJob?.provider_message_id);

    const autoReplyThread = await deliverReply({
      harness,
      threadId,
      mailboxId: sentJob!.mailbox_id,
      mailboxEmail: graph.mailboxEmailsByKey.get('mailbox-1')!,
      leadEmail: `lead-${harness.namespace}@furnace.test`,
      providerMessageId: sentJob!.provider_message_id,
      bodyText: 'I am out of office until next week.',
      autoReply: true,
    });

    assert.equal(autoReplyThread.category, 'Auto Reply');
    assert.equal(autoReplyThread.category_source, 'system');
    assert.equal(autoReplyThread.conversation_status, 'closed');
    assert.equal(autoReplyThread.classification_status, 'complete');
    assert.equal(autoReplyThread.has_reply, true);

    const reopenedThread = await deliverReply({
      harness,
      threadId,
      mailboxId: sentJob!.mailbox_id,
      mailboxEmail: graph.mailboxEmailsByKey.get('mailbox-1')!,
      leadEmail: `lead-${harness.namespace}@furnace.test`,
      providerMessageId: sentJob!.provider_message_id,
      bodyText: 'Back now, happy to talk.',
    });

    assert.equal(reopenedThread.category, null);
    assert.equal(reopenedThread.category_source, null);
    assert.equal(reopenedThread.conversation_status, 'open');
    assert.equal(reopenedThread.classification_status, 'pending');
  } finally {
    await harness.cleanup();
  }
});

test('AI classify writes category and handling metadata without auto-closing the thread', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('conversation-ai-open') });
  const now = Date.now();
  const originalFetch = global.fetch;

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Conversation AI Open',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: AI mode thread',
            hasReply: true,
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
              buildThreadMessage({
                direction: 'received',
                messageId: `<reply-${harness.namespace}@furnace.test>`,
                inReplyTo: `<orig-${harness.namespace}@furnace.test>`,
                bodyText: 'Please send pricing details.',
                receivedAt: new Date(now - 5 * 60_000).toISOString(),
                readAt: null,
              }),
            ],
          }),
        }),
      ],
    });

    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('openrouter.ai')) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: 'Interested',
                    return_date: null,
                  }),
                },
              },
            ],
          }),
        } as Response;
      }
      return originalFetch(input as any, init);
    }) as typeof fetch;

    const lead = graph.leadsByKey.get('lead')!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({
        classification_status: 'pending',
        conversation_status: 'open',
      })
      .eq('id', lead.threadId!);
    assert.equal(seedError, null);
    const emailMessageId = await getLatestReceivedMessageId(harness, lead.threadId!);
    const response = await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: true,
        useAi: true,
      }),
    );

    assert.deepEqual(response.batchItemFailures, []);

    const thread = await getThread(harness, lead.threadId!);
    assert.equal(thread.category, 'Interested');
    assert.equal(thread.category_source, 'ai');
    assert.equal(thread.classification_status, 'complete');
    assert.equal(thread.conversation_status, 'open');
    assert.equal((thread.handling_metadata as any)?.mode, 'ai');
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});
