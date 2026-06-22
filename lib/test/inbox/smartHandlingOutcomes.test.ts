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
import { handler as classifyReplyHandler } from '../../../amplify/functions/classifyReply/handler';
import { resolveSuggestionVersion } from '../../inbox/smartHandlingVersion';

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

test('manual-mode Auto Reply classification writes dated OOO smart-handling options and keeps the thread open', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('smart-handling-ooo') });
  const originalFetch = global.fetch;
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Smart Handling OOO',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: false,
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
            subject: 'Re: Out for a week',
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
                bodyText: 'I am out until next Friday.',
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
                    category: 'Auto Reply',
                    return_date: '2026-06-26',
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
    await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: true,
        useAi: false,
      }),
    );

    const thread = await getThread(harness, lead.threadId!);
    const metadata = thread.handling_metadata as any;

    assert.equal(thread.category, null);
    assert.equal(thread.classification_status, 'complete');
    assert.equal(thread.conversation_status, 'open');
    assert.equal(metadata.mode, 'manual');
    assert.equal(metadata.suggestion_version, resolveSuggestionVersion('manual'));
    assert.equal(metadata.primary.action, 'mark_ooo_dated');
    assert.equal(metadata.return_date, '2026-06-26');
    assert.ok(Array.isArray(metadata.alternatives));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_instant'));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_custom'));
    assert.ok(!metadata.alternatives.some((option: any) => option.action === 'mark_ooo_month'));
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});

test('manual-mode Auto Reply classification without a return date defaults to month primary with instant and custom alternatives', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('smart-handling-ooo-no-date'),
  });
  const originalFetch = global.fetch;
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Smart Handling OOO No Date',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: false,
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
            subject: 'Re: Away from email',
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
                bodyText: 'I am currently away from email and will respond when I can.',
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
                    category: 'Auto Reply',
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
    await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: true,
        useAi: false,
      }),
    );

    const thread = await getThread(harness, lead.threadId!);
    const metadata = thread.handling_metadata as any;

    assert.equal(metadata.mode, 'manual');
    assert.equal(metadata.suggestion_version, resolveSuggestionVersion('manual'));
    assert.equal(metadata.primary.action, 'mark_ooo_month');
    assert.equal(metadata.return_date, null);
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_instant'));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_custom'));
    assert.ok(!metadata.alternatives.some((option: any) => option.action === 'mark_ooo_dated'));
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});

test('manual-mode Auto Reply departure autoresponder promotes replace lead with auto reply forward reason', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('smart-handling-auto-reply-forward'),
  });
  const originalFetch = global.fetch;
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Smart Handling Auto Reply Forward',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: false,
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: 'rmastropietro@passagebio.com',
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
            subject: 'Automatic reply: NetSuite Renewal',
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
                fromEmail: 'rmastropietro_c@passagebio.com',
                messageId: `<reply-${harness.namespace}@furnace.test>`,
                inReplyTo: `<orig-${harness.namespace}@furnace.test>`,
                bodyText:
                  'Rich Mastropietro is no longer with Passage Bio. Please contact Kathleen Borthwick at kborthwick@passagebio.com with any inquiries.',
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
                    category: 'Auto Reply',
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
    await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: true,
        useAi: false,
      }),
    );

    const thread = await getThread(harness, lead.threadId!);
    const metadata = thread.handling_metadata as any;

    assert.equal(metadata.mode, 'manual');
    assert.equal(metadata.suggestion_version, resolveSuggestionVersion('manual'));
    assert.equal(metadata.category, 'Auto Reply');
    assert.equal(metadata.header_mismatch, true);
    assert.equal(metadata.primary.action, 'replace_lead');
    assert.equal(metadata.suggested_referral.email, 'kborthwick@passagebio.com');
    assert.equal(metadata.suggested_referral.firstName, 'Kathleen');
    assert.equal(metadata.suggested_referral.lastName, 'Borthwick');
    assert.equal(metadata.suggested_referral.reason, 'auto_reply_forward');
    assert.ok(Array.isArray(metadata.alternatives));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_neutral'));
    assert.notEqual(metadata.primary.action, 'mark_ooo_month');
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});

test('manual-mode Auto Reply true OOO regression keeps OOO actions when sender still matches the lead', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('smart-handling-auto-reply-regression'),
  });
  const originalFetch = global.fetch;
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Smart Handling Auto Reply Regression',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: false,
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
            subject: 'Automatic reply: Away from email',
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
                fromEmail: `lead-${harness.namespace}@furnace.test`,
                messageId: `<reply-${harness.namespace}@furnace.test>`,
                inReplyTo: `<orig-${harness.namespace}@furnace.test>`,
                bodyText: 'I am currently away from email and will respond when I can.',
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
                    category: 'Auto Reply',
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
    await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: true,
        useAi: false,
      }),
    );

    const thread = await getThread(harness, lead.threadId!);
    const metadata = thread.handling_metadata as any;

    assert.equal(metadata.mode, 'manual');
    assert.equal(metadata.suggestion_version, resolveSuggestionVersion('manual'));
    assert.equal(metadata.header_mismatch, false);
    assert.equal(metadata.suggested_referral, null);
    assert.equal(metadata.primary.action, 'mark_ooo_month');
    assert.equal(metadata.return_date, null);
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_instant'));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_ooo_custom'));
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});

test('manual-mode classification promotes replace lead when the inbound sender mismatches the lead email', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('smart-handling-replace') });
  const originalFetch = global.fetch;
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;
    process.env.SUPABASE_URL = harness.env.supabaseUrl;
    process.env.EXPO_PUBLIC_SUPABASE_URL = harness.env.supabaseUrl;
    process.env.SUPABASE_SECRET_KEY = harness.env.serviceRoleKey;
    process.env.OPENROUTER_API_KEY = 'test-key';

    const graph = await harness.createCampaignGraph({
      name: 'Smart Handling Replace Lead',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `original-${harness.namespace}@furnace.test`,
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
            subject: 'Re: Wrong person',
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
                fromEmail: `new-contact-${harness.namespace}@furnace.test`,
                messageId: `<reply-${harness.namespace}@furnace.test>`,
                inReplyTo: `<orig-${harness.namespace}@furnace.test>`,
                bodyText: 'You should talk to someone else on our team.',
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
    await classifyReplyHandler(
      makeSqsEvent({
        emailMessageId,
        threadId: lead.threadId,
        enrollmentId: lead.enrollmentId,
        campaignId: graph.campaignId,
        hasCategorizer: false,
        useAi: false,
      }),
    );

    const thread = await getThread(harness, lead.threadId!);
    const metadata = thread.handling_metadata as any;

    assert.equal(metadata.mode, 'manual');
    assert.equal(metadata.suggestion_version, resolveSuggestionVersion('manual'));
    assert.equal(metadata.header_mismatch, true);
    assert.equal(metadata.primary.action, 'replace_lead');
    assert.ok(Array.isArray(metadata.alternatives));
    assert.ok(metadata.alternatives.some((option: any) => option.action === 'mark_interested_reply'));
  } finally {
    global.fetch = originalFetch;
    await harness.cleanup();
  }
});
