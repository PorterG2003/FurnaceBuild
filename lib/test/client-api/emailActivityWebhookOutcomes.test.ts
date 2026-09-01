import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDisplayBody } from '@furnace/email-lib';
import { CampaignDbHarness } from '../campaign/harness.js';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from '../campaign/fixtures.js';
import { SendWorker } from '../../../workers/send-worker/src/worker.js';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager.js';
import type { ProcessedMessage } from '../../../workers/inbox-checker-worker/src/types.js';

const QUOTED_REPLY = [
  'Thursday works — send a hold.',
  '',
  'On Mon, Jan 5, 2026 at 9:02 AM AEO <aeo@furnaceoutbound.com> wrote:',
  '> Quick check-in for next week',
].join('\n');

async function loadLatestWebhookPayload(
  harness: CampaignDbHarness,
  accountId: string,
  eventType: string,
  campaignId: string,
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const { data, error } = await harness.supabase
    .from('webhook_events')
    .select('id, payload')
    .eq('account_id', accountId)
    .eq('event_type', eventType)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(error, null, error?.message);
  assert.ok(data, `expected ${eventType} webhook event`);
  return {
    id: data.id as string,
    payload: (data.payload ?? {}) as Record<string, unknown>,
  };
}

test('email.sent and reply.received webhook payloads match campaign graph identity', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('email-activity-webhooks'),
  });
  const webhookEventIds: string[] = [];
  const campaignName = `Wasatch corridor ${harness.namespace}`;
  const leadEmail = `lead-${harness.namespace}@example.com`;
  const mailboxEmail = `sender-${harness.namespace}@example.com`;

  try {
    const graph = await harness.createCampaignGraph({
      name: campaignName,
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: mailboxEmail,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'target',
          email: leadEmail,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('target')!;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;
    const nodeId = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const scheduledAt = new Date().toISOString();
    const messageJobId = randomUUID();
    const providerMessageId = `<sent-${harness.namespace}@furnace.test>`;

    const { error: enrichError } = await harness.supabase
      .from('leads')
      .update({
        last_name: 'Reed',
        company_name: 'Wasatch Corridor',
        linkedin_url: 'https://linkedin.com/in/casey-reed',
        website: 'https://wasatch.example',
        custom_lead_data: { title: 'VP Sales', region: 'west' },
      } as never)
      .eq('id', lead.leadId);
    assert.equal(enrichError, null);

    const { error: jobError } = await harness.supabase.from('message_jobs').insert({
      id: messageJobId,
      enrollment_id: lead.enrollmentId,
      campaign_id: graph.campaignId,
      account_id: graph.accountId,
      lead_id: lead.leadId,
      mailbox_id: mailboxId,
      node_id: nodeId,
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
      message_type: 'campaign',
      send_wait_reason: null,
      interval_id: null,
      message_data: {
        step_number: 1,
        node_config: {
          subject: 'Quick check-in',
          body_html: '<p>Hi {{first_name}}</p>',
          body_text: 'Hi {{first_name}}',
        },
      },
    } as any);
    assert.equal(jobError, null);
    graph.manifest.messageJobIds.push(messageJobId);

    const sendWorker = new SendWorker({
      supabase: harness.supabase as any,
      databaseClient: {} as any,
      campaignEmailSender: async () => ({
        submittedMessageId: providerMessageId,
        providerMessageId,
      }),
    });
    (sendWorker as any).smtpPool = {
      getTransporter: async () => ({}),
      markMessageSent: () => {},
      closeAll: async () => {},
    };

    const { data: messageJobRow, error: messageJobLoadError } = await harness.supabase
      .from('message_jobs')
      .select('*')
      .eq('id', messageJobId)
      .single();
    assert.equal(messageJobLoadError, null);
    await (sendWorker as any).processMessageJob(messageJobRow);

    const sentEvent = await loadLatestWebhookPayload(
      harness,
      graph.accountId,
      'email.sent',
      graph.campaignId,
    );
    webhookEventIds.push(sentEvent.id);

    const { data: jobAfterSend, error: jobAfterSendError } = await harness.supabase
      .from('message_jobs')
      .select('status')
      .eq('id', messageJobId)
      .single();
    assert.equal(jobAfterSendError, null);
    assert.equal(jobAfterSend?.status, 'sent');

    const { data: leadRow } = await harness.supabase
      .from('leads')
      .select('email, first_name, last_name, company_name, linkedin_url, website, custom_lead_data')
      .eq('id', lead.leadId)
      .single();
    const { data: mailboxRow, error: mailboxError } = await harness.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', mailboxId)
      .single();
    assert.equal(mailboxError, null);
    const { data: campaignRow } = await harness.supabase
      .from('campaigns')
      .select('name')
      .eq('id', graph.campaignId)
      .single();

    assert.equal(sentEvent.payload.email, leadRow?.email);
    assert.equal(sentEvent.payload.mailbox_email, mailboxRow?.email_address);
    assert.equal(sentEvent.payload.campaign_name, campaignRow?.name);
    assert.equal(sentEvent.payload.lead_id, lead.leadId);
    assert.equal(sentEvent.payload.campaign_id, graph.campaignId);
    assert.equal(sentEvent.payload.mailbox_id, mailboxId);
    assert.equal(sentEvent.payload.message_job_id, messageJobId);
    assert.equal(sentEvent.payload.first_name, leadRow?.first_name);
    assert.equal(sentEvent.payload.last_name, leadRow?.last_name);
    assert.equal(sentEvent.payload.company_name, leadRow?.company_name);
    assert.equal(sentEvent.payload.linkedin_url, leadRow?.linkedin_url);
    assert.equal(sentEvent.payload.website, leadRow?.website);
    assert.equal(sentEvent.payload.title, 'VP Sales');
    assert.deepEqual(sentEvent.payload.custom_fields, { region: 'west', title: 'VP Sales' });
    assert.equal(sentEvent.payload.step_number, 1);
    assert.equal(typeof sentEvent.payload.body_text, 'string');

    const threadManager = new ThreadManager(harness.supabase as any);
    const inbound: ProcessedMessage = {
      uid: 501,
      messageId: `<reply-${harness.namespace}@example.com>`,
      inReplyTo: providerMessageId,
      references: providerMessageId,
      referenceMessageIds: [providerMessageId.replace(/^<|>$/g, '')],
      threadTopic: null,
      threadIndex: null,
      from: { address: leadEmail, name: 'Casey' },
      to: [{ address: mailboxEmail, name: 'Sender' }],
      cc: [],
      subject: 'Re: Quick check-in',
      bodyText: QUOTED_REPLY,
      bodyHtml: `<p>${QUOTED_REPLY}</p>`,
      date: new Date(),
      headers: {},
      attachments: [],
    };
    const replyHandled = await threadManager.handleReply(mailboxRow as any, inbound);
    assert.equal(replyHandled, true);

    const replyEvent = await loadLatestWebhookPayload(
      harness,
      graph.accountId,
      'reply.received',
      graph.campaignId,
    );
    webhookEventIds.push(replyEvent.id);

    const expectedBody = getDisplayBody(QUOTED_REPLY);
    assert.equal(replyEvent.payload.from_email, leadEmail);
    assert.equal(replyEvent.payload.body_text, expectedBody);
    assert.notEqual(replyEvent.payload.body_text, replyEvent.payload.subject);
    assert.doesNotMatch(String(replyEvent.payload.body_text), /Quick check-in for next week/);
    assert.equal(replyEvent.payload.mailbox_email, mailboxRow?.email_address);
    assert.equal(replyEvent.payload.campaign_name, campaignRow?.name);
    assert.equal(replyEvent.payload.lead_id, lead.leadId);
    assert.equal(replyEvent.payload.campaign_id, graph.campaignId);
    assert.equal(replyEvent.payload.email, leadEmail);
    assert.equal(replyEvent.payload.first_name, leadRow?.first_name);
    assert.equal(replyEvent.payload.company_name, leadRow?.company_name);
    assert.deepEqual(replyEvent.payload.custom_fields, { region: 'west', title: 'VP Sales' });
  } finally {
    if (webhookEventIds.length > 0) {
      await harness.supabase.from('webhook_events').delete().in('id', webhookEventIds);
    }
    await harness.cleanup();
  }
});
