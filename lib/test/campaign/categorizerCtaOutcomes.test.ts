import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from './fixtures';
import { CTA_OUTBOUND_PERMISSION, CTA_SCENARIOS } from '../../../lib/categorizer/ctaScenarios';
import { normalizeMessageId } from '../../../lib/email/threadHeaders';
import {
  getEnrollmentRow,
  getThreadRow,
  simulateClassifyLambda,
} from './categorizer-helpers';

/**
 * CTA-aware categorizer-v2 outcomes: prompt assembly through the real
 * classifyReply Lambda path (scripted LLM, zero OpenRouter).
 */

const AFFIRMATIVE = CTA_SCENARIOS.find((s) => s.id === 'affirmative-yes-please')!;

async function seedCtaThread(
  harness: CampaignDbHarness,
  params: {
    name: string;
    replyBody: string;
    outboundBody?: string;
    withInboxReply?: boolean;
  },
) {
  const now = Date.now();
  const leadEmail = `lead-${harness.namespace}@furnace.test`;
  const campaignMessageId = `<campaign-${harness.namespace}@furnace.test>`;
  const replyMessageId = `<reply-${harness.namespace}@furnace.test>`;
  const outboundBody = params.outboundBody ?? CTA_OUTBOUND_PERMISSION.bodyText!;

  const messages = [
    buildThreadMessage({
      direction: 'sent',
      subject: CTA_OUTBOUND_PERMISSION.subject,
      bodyText: outboundBody,
      messageId: campaignMessageId,
      receivedAt: new Date(now - 20 * 60_000).toISOString(),
      readAt: new Date(now - 20 * 60_000).toISOString(),
    }),
  ];

  if (params.withInboxReply) {
    messages.push(
      buildThreadMessage({
        direction: 'sent',
        subject: 'Re: Quick question about training',
        bodyText: 'HUMAN INBOX REPLY BODY — should not appear in categorizer outbound context',
        messageId: `<inbox-${harness.namespace}@furnace.test>`,
        inReplyTo: campaignMessageId,
        receivedAt: new Date(now - 10 * 60_000).toISOString(),
        readAt: new Date(now - 10 * 60_000).toISOString(),
      }),
    );
  }

  messages.push(
    buildThreadMessage({
      direction: 'received',
      subject: 'Re: Quick question about training',
      bodyText: params.replyBody,
      messageId: replyMessageId,
      inReplyTo: params.withInboxReply
        ? `<inbox-${harness.namespace}@furnace.test>`
        : campaignMessageId,
      receivedAt: new Date(now - 5 * 60_000).toISOString(),
      readAt: null,
    }),
  );

  const graph = await harness.createCampaignGraph({
    name: params.name,
    status: 'running',
    flowKind: 'emailWaitEmailCategorizer',
    categorizerUseAi: true,
    leads: [
      buildCampaignLead({
        key: 'subject',
        email: leadEmail,
        mailboxKey: 'mailbox-1',
        enrollment: buildCampaignEnrollment({
          state: 'active',
          currentFlowNodeId: 'aiCategorizer-1',
          heldNodeFlowNodeId: 'waitTime-1',
          nextRunAt: new Date(now - 60_000).toISOString(),
        }),
        jobs: [
          buildCampaignJob({
            key: 'sent-1',
            nodeFlowNodeId: 'email-1',
            status: 'sent',
            scheduledAt: new Date(now - 30 * 60_000).toISOString(),
            sentAt: new Date(now - 20 * 60_000).toISOString(),
            providerMessageId: campaignMessageId,
            messageType: 'campaign',
          }),
          ...(params.withInboxReply
            ? [
                buildCampaignJob({
                  key: 'inbox-sent',
                  status: 'sent',
                  scheduledAt: new Date(now - 10 * 60_000).toISOString(),
                  sentAt: new Date(now - 10 * 60_000).toISOString(),
                  providerMessageId: `<inbox-${harness.namespace}@furnace.test>`,
                  messageType: 'inbox_reply',
                  messageData: { source: 'inbox_reply' },
                }),
              ]
            : []),
          buildCampaignJob({
            key: 'held-2',
            nodeFlowNodeId: 'email-2',
            status: 'held',
            scheduledAt: new Date(now + 60 * 60_000).toISOString(),
          }),
        ],
        thread: buildCampaignThread({
          subject: 'Re: Quick question about training',
          hasReply: true,
          category: null,
          categorySource: null,
          classificationStatus: 'pending',
          messageJobKey: 'sent-1',
          messages,
        }),
      }),
    ],
  });

  const lead = graph.leadsByKey.get('subject')!;
  assert.ok(lead.threadId);

  // Harness assigns every seeded sent row the thread's campaign job id.
  // Relink the human send to the dedicated inbox_reply job when present.
  if (params.withInboxReply) {
    const inboxJobId = lead.messageJobIdsByKey.get('inbox-sent');
    assert.ok(inboxJobId);
    const inboxRawId = `<inbox-${harness.namespace}@furnace.test>`;
    const { error: relinkError } = await harness.supabase
      .from('email_messages')
      .update({
        message_job_id: inboxJobId,
        message_id: normalizeMessageId(inboxRawId),
      })
      .eq('thread_id', lead.threadId!)
      .eq('message_id', inboxRawId);
    assert.equal(relinkError, null);
  }

  // Normalize campaign / reply ids for header matching.
  await harness.supabase
    .from('email_messages')
    .update({ message_id: normalizeMessageId(campaignMessageId) })
    .eq('thread_id', lead.threadId!)
    .eq('direction', 'sent')
    .eq('message_job_id', lead.messageJobIdsByKey.get('sent-1')!);

  await harness.supabase
    .from('email_messages')
    .update({
      message_id: normalizeMessageId(replyMessageId),
      in_reply_to: params.withInboxReply
        ? normalizeMessageId(`inbox-${harness.namespace}@furnace.test`)
        : normalizeMessageId(campaignMessageId),
      reference_message_ids: params.withInboxReply
        ? [
            normalizeMessageId(`inbox-${harness.namespace}@furnace.test`)!,
            normalizeMessageId(campaignMessageId)!,
          ]
        : [normalizeMessageId(campaignMessageId)!],
    })
    .eq('thread_id', lead.threadId!)
    .eq('direction', 'received');

  return { graph, lead, campaignMessageId, outboundBody };
}

test('CTA prompt assembly: classify Lambda user prompt includes campaign outbound + reply', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-cta-prompt'),
  });

  try {
    const { lead, outboundBody } = await seedCtaThread(harness, {
      name: 'Categorizer CTA Prompt Assembly',
      replyBody: AFFIRMATIVE.reply.bodyText!,
    });

    const result = await simulateClassifyLambda(
      harness,
      { threadId: lead.threadId!, useAi: true, hasCategorizer: true },
      [{ kind: 'classify', category: AFFIRMATIVE.expectedCategory }],
    );

    assert.equal(result.ok, true);
    assert.equal(result.calls.length, 1);
    const user = result.calls[0]!.user;
    assert.ok(user.includes(outboundBody.slice(0, 40)), 'prompt must include campaign CTA body');
    assert.ok(user.includes(AFFIRMATIVE.reply.bodyText!), 'prompt must include reply text');
    assert.ok(user.includes('Prior outbound:'));
    assert.ok(user.includes('Inbound reply:'));

    const thread = await getThreadRow(harness, lead.threadId!);
    assert.equal(thread.category, 'Interested');
    assert.equal(thread.category_source, 'ai');
    assert.equal(thread.classification_status, 'complete');
    assert.equal(thread.handling_metadata?.suggestion_version, 'categorizer-v2');

    const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
    assert.ok(enrollment.next_run_at, 'AI Interested should wake the parked enrollment');
  } finally {
    await harness.cleanup();
  }
});

test('CTA prompt assembly: inbox_reply sent must not win over campaign outbound', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-cta-inbox-skip'),
  });

  try {
    const { lead, outboundBody } = await seedCtaThread(harness, {
      name: 'Categorizer CTA Skip Inbox Reply',
      replyBody: 'Yes, please!',
      withInboxReply: true,
    });

    const result = await simulateClassifyLambda(
      harness,
      { threadId: lead.threadId!, useAi: true, hasCategorizer: true },
      [{ kind: 'classify', category: 'Interested' }],
    );

    assert.equal(result.ok, true);
    assert.equal(result.calls.length, 1);
    const user = result.calls[0]!.user;
    assert.ok(user.includes(outboundBody.slice(0, 40)), 'must keep campaign CTA');
    assert.ok(
      !user.includes('HUMAN INBOX REPLY BODY'),
      'must not use human inbox_reply as prior outbound',
    );
  } finally {
    await harness.cleanup();
  }
});

test('classify failure marks failed without category (give_up documented at unit layer)', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('cat-cta-fail'),
  });

  try {
    const { lead } = await seedCtaThread(harness, {
      name: 'Categorizer CTA Fail',
      replyBody: 'Yes, please!',
    });

    const result = await simulateClassifyLambda(
      harness,
      { threadId: lead.threadId!, useAi: true, hasCategorizer: true },
      [{ kind: 'fail', details: 'upstream exploded', httpStatus: 502 }],
    );

    assert.equal(result.ok, false);
    const thread = await getThreadRow(harness, lead.threadId!);
    assert.equal(thread.classification_status, 'failed');
    assert.equal(thread.category, null);
  } finally {
    await harness.cleanup();
  }
});
