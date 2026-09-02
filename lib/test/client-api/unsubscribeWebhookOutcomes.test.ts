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
import { ensureBlockListWebhookSchema } from './webhook-outcome-helpers.js';

function unsubscribeMessage(fromEmail: string): ProcessedMessage {
  return {
    uid: 801,
    messageId: `<unsub-${fromEmail}>`,
    inReplyTo: null,
    references: null,
    referenceMessageIds: [],
    threadTopic: null,
    threadIndex: null,
    from: { address: fromEmail, name: 'Casey' },
    to: [{ address: 'sender@example.com', name: 'Sender' }],
    cc: [],
    subject: 'unsubscribe',
    bodyText: 'Please unsubscribe me',
    bodyHtml: '',
    date: new Date(),
    headers: {},
    attachments: [],
  };
}

test('autoBlockUnsubscribe emits blocklist.entry_added and writes block_list', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('unsub-webhooks'),
  });
  const webhookEventIds: string[] = [];
  const leadEmail = `lead-${harness.namespace}@example.com`;
  const mailboxEmail = `sender-${harness.namespace}@example.com`;
  let accountId: string | undefined;

  try {
    const graph = await harness.createCampaignGraph({
      name: `Unsub ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [{ key: 'mailbox-1', emailAddress: mailboxEmail, displayName: 'Sender' }],
      leads: [
        buildCampaignLead({
          key: 'target',
          email: leadEmail,
          firstName: 'Casey',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
          }),
          jobs: [buildCampaignJob({ status: 'sent', sentAt: new Date().toISOString() })],
        }),
      ],
    });
    accountId = graph.accountId;
    if (!(await ensureBlockListWebhookSchema(harness.supabase, t))) return;

    const { data: mailboxRow } = await harness.supabase
      .from('mailboxes')
      .select('*')
      .eq('id', graph.mailboxIdsByKey.get('mailbox-1')!)
      .single();

    const threadManager = new ThreadManager(harness.supabase as any);
    await threadManager.autoBlockUnsubscribe(mailboxRow as any, unsubscribeMessage(leadEmail));

    const { data, error } = await harness.supabase
      .from('webhook_events')
      .select('id, payload')
      .eq('account_id', graph.accountId)
      .eq('event_type', 'blocklist.entry_added')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    assert.equal(error, null);
    assert.ok(data);
    webhookEventIds.push(data.id as string);

    const payload = (data.payload ?? {}) as Record<string, unknown>;
    assert.equal(payload.email, leadEmail);
    assert.equal(payload.value, leadEmail);
    assert.equal(payload.type, 'email');
    assert.equal(payload.source, 'reply_opt_out');
    assert.equal(payload.reason, 'unsubscribed');

    const { data: blockRow } = await harness.supabase
      .from('block_list')
      .select('value, reason, source')
      .eq('account_id', graph.accountId)
      .eq('value', leadEmail)
      .maybeSingle();
    assert.equal(blockRow?.reason, 'unsubscribed');
    assert.equal(blockRow?.source, 'reply_opt_out');

    const { count: leftoverBlocked } = await harness.supabase
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', graph.accountId)
      .eq('event_type', 'blocked');
    assert.equal(leftoverBlocked, 0);
  } finally {
    if (accountId) {
      await harness.supabase
        .from('block_list')
        .delete()
        .eq('account_id', accountId)
        .eq('value', leadEmail);
    }
    if (accountId) {
      await harness.supabase.from('webhook_events').delete().eq('account_id', accountId);
    } else if (webhookEventIds.length > 0) {
      await harness.supabase.from('webhook_events').delete().in('id', webhookEventIds);
    }
    await harness.cleanup();
  }
});

test('autoBlockUnsubscribe emits nothing when the sender matches no sent job', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('unsub-unmatched'),
  });
  const mailboxEmail = `sender-${harness.namespace}@example.com`;

  try {
    const graph = await harness.createCampaignGraph({
      name: `Unsub unmatched ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [{ key: 'mailbox-1', emailAddress: mailboxEmail, displayName: 'Sender' }],
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
    await threadManager.autoBlockUnsubscribe(
      mailboxRow as any,
      unsubscribeMessage(`stranger-${harness.namespace}@example.com`),
    );

    const { count } = await harness.supabase
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', graph.accountId)
      .eq('campaign_id', graph.campaignId)
      .eq('event_type', 'blocklist.entry_added');
    assert.equal(count, 0);
  } finally {
    await harness.cleanup();
  }
});
