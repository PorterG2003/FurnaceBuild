import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from '../campaign/harness.js';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from '../campaign/fixtures.js';
import { ThreadManager } from '../../../workers/inbox-checker-worker/src/thread-manager.js';
import type { ProcessedMessage } from '../../../workers/inbox-checker-worker/src/types.js';

function bounceMessage(leadEmail: string): ProcessedMessage {
  return {
    uid: 701,
    messageId: `<bounce-${leadEmail}>`,
    inReplyTo: null,
    references: null,
    referenceMessageIds: [],
    threadTopic: null,
    threadIndex: null,
    from: { address: 'mailer-daemon@example.com', name: 'Mail Delivery' },
    to: [{ address: 'sender@example.com', name: 'Sender' }],
    cc: [],
    subject: 'Delivery Status Notification (Failure)',
    bodyText: `550 5.1.1 User unknown ${leadEmail}`,
    bodyHtml: '',
    date: new Date(),
    headers: {},
    attachments: [],
  };
}

test('handleBounce webhook includes lead email, mailbox, campaign, and reason', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('bounce-webhooks'),
  });
  const webhookEventIds: string[] = [];
  const leadEmail = `lead-${harness.namespace}@example.com`;
  const mailboxEmail = `sender-${harness.namespace}@example.com`;

  try {
    const graph = await harness.createCampaignGraph({
      name: `Bounce ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [{ key: 'mailbox-1', emailAddress: mailboxEmail, displayName: 'Sender' }],
      leads: [
        buildCampaignLead({
          key: 'target',
          email: leadEmail,
          firstName: 'Casey',
          lastName: 'Reed',
          companyName: 'Wasatch Corridor',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          jobs: [buildCampaignJob({ status: 'sent', sentAt: new Date().toISOString() })],
        }),
      ],
    });

    const { data: mailboxRow, error: mailboxError } = await harness.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', graph.mailboxIdsByKey.get('mailbox-1')!)
      .single();
    assert.equal(mailboxError, null);

    const threadManager = new ThreadManager(harness.supabase as any);
    await threadManager.handleBounce(mailboxRow as any, bounceMessage(leadEmail));

    const { data, error } = await harness.supabase
      .from('webhook_events')
      .select('id, payload')
      .eq('account_id', graph.accountId)
      .eq('event_type', 'bounce.detected')
      .eq('campaign_id', graph.campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    assert.equal(error, null);
    assert.ok(data);
    webhookEventIds.push(data.id as string);

    const payload = (data.payload ?? {}) as Record<string, unknown>;
    assert.equal(payload.email, leadEmail);
    assert.equal(payload.mailbox_email, mailboxEmail);
    assert.equal(payload.campaign_name, `Bounce ${harness.namespace}`);
    assert.equal(payload.first_name, 'Casey');
    assert.match(String(payload.reason), /hard|soft/);
    assert.ok(Array.isArray(payload.candidate_emails));
  } finally {
    if (webhookEventIds.length > 0) {
      await harness.supabase.from('webhook_events').delete().in('id', webhookEventIds);
    }
    await harness.cleanup();
  }
});

test('handleBounce emits nothing when no sent job matches', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('bounce-unmatched'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: `Bounce unmatched ${harness.namespace}`,
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
          key: 'target',
          email: `lead-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          jobs: [buildCampaignJob({ status: 'sent', sentAt: new Date().toISOString() })],
        }),
      ],
    });

    const { data: mailboxRow } = await harness.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', graph.mailboxIdsByKey.get('mailbox-1')!)
      .single();

    const threadManager = new ThreadManager(harness.supabase as any);
    await threadManager.handleBounce(
      mailboxRow as any,
      bounceMessage(`nobody-${harness.namespace}@example.com`),
    );

    const { count } = await harness.supabase
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', graph.accountId)
      .eq('campaign_id', graph.campaignId)
      .eq('event_type', 'bounce.detected');
    assert.equal(count, 0);
  } finally {
    await harness.cleanup();
  }
});
