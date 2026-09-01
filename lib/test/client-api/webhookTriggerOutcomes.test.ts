import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import { ensureWebhookInfrastructureSchema, latestWebhookEvent } from './webhook-outcome-helpers.js';

test('furnace_emit_webhook_event inserts allowlisted events with dedupe', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-emit-rpc'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const dedupeKey = `${harness.namespace}-emit-once`;
    const first = await harness.supabase.rpc('furnace_emit_webhook_event', {
      p_account_id: harness.accountId,
      p_campaign_id: null,
      p_event_type: 'reply.categorized',
      p_payload: { thread_id: 'thread-1', category: 'Interested' },
      p_dedupe_key: dedupeKey,
    });
    assert.equal(first.error, null);
    assert.ok(first.data);

    const second = await harness.supabase.rpc('furnace_emit_webhook_event', {
      p_account_id: harness.accountId,
      p_campaign_id: null,
      p_event_type: 'reply.categorized',
      p_payload: { thread_id: 'thread-1', category: 'Interested' },
      p_dedupe_key: dedupeKey,
    });
    assert.equal(second.error, null);
    assert.equal(second.data, null);

    const { count } = await harness.supabase
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('dedupe_key', dedupeKey);
    assert.equal(count, 1);

    const { data: row } = await harness.supabase
      .from('webhook_events')
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (row?.id) harness.trackedWebhookEventIds.add(row.id as string);
  } finally {
    await harness.cleanup();
  }
});

test('email thread category update emits reply.categorized webhook', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-category-trigger'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Category Trigger',
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
        {
          key: 'lead-1',
          email: `lead-${harness.namespace}@example.com`,
          mailboxKey: 'mailbox-1',
          enrollment: {
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date().toISOString(),
          },
          thread: {
            subject: 'Webhook category trigger',
            lastMessageAt: new Date().toISOString(),
            category: 'Neutral',
            conversationStatus: 'open',
            messages: [
              {
                direction: 'received',
                subject: 'Webhook category trigger',
                bodyText: 'Interested reply',
                fromEmail: `lead-${harness.namespace}@example.com`,
                toEmail: `sender-${harness.namespace}@example.com`,
                receivedAt: new Date().toISOString(),
                messageId: `<received-${harness.namespace}@example.com>`,
              },
            ],
          },
        },
      ],
    });

    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;
    const { error: updateError } = await harness.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'user',
      } as never)
      .eq('id', threadId);
    assert.equal(updateError, null);

    const event = await latestWebhookEvent(harness, 'reply.categorized');
    assert.ok(event);
    assert.equal(event.payload.thread_id, threadId);
    assert.equal(event.payload.category, 'Interested');
    assert.equal(event.payload.previous_category, 'Neutral');
    assert.equal(event.payload.category_source, 'user');

    const { error: identityError } = await harness.supabase.rpc('private_lead_webhook_identity', {
      p_lead_id: graph.leadsByKey.get('lead-1')!.leadId,
      p_campaign_id: graph.campaignId,
      p_mailbox_id: graph.mailboxIdsByKey.get('mailbox-1')!,
    });
    if (!identityError) {
      assert.equal(event.payload.campaign_name, 'Webhook Category Trigger');
      assert.equal(typeof event.payload.mailbox_email, 'string');
      assert.equal(event.payload.from_email, `lead-${harness.namespace}@example.com`);
    }
  } finally {
    await harness.cleanup();
  }
});

test('reply.categorized still emits identity when the thread has no received message', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-category-no-inbound'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;
    const { error: identityError } = await harness.supabase.rpc('private_lead_webhook_identity', {
      p_lead_id: '00000000-0000-4000-8000-000000000001',
      p_campaign_id: null,
      p_mailbox_id: null,
    });
    if (identityError) {
      t.skip(`private_lead_webhook_identity unavailable: ${identityError.message}`);
      return;
    }

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Category No Inbound',
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
        {
          key: 'lead-1',
          email: `lead-${harness.namespace}@example.com`,
          mailboxKey: 'mailbox-1',
          enrollment: {
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date().toISOString(),
          },
          thread: {
            subject: 'Outbound only',
            lastMessageAt: new Date().toISOString(),
            category: 'Neutral',
            conversationStatus: 'open',
            messages: [
              {
                direction: 'sent',
                subject: 'Outbound only',
                bodyText: 'Hi',
                fromEmail: `sender-${harness.namespace}@example.com`,
                toEmail: `lead-${harness.namespace}@example.com`,
                receivedAt: new Date().toISOString(),
                messageId: `<sent-${harness.namespace}@example.com>`,
              },
            ],
          },
        },
      ],
    });

    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;
    const { error: updateError } = await harness.supabase
      .from('email_threads')
      .update({
        category: 'Interested',
        category_source: 'user',
      } as never)
      .eq('id', threadId);
    assert.equal(updateError, null);

    const event = await latestWebhookEvent(harness, 'reply.categorized');
    assert.ok(event);
    assert.equal(event.payload.thread_id, threadId);
    assert.equal(event.payload.campaign_name, 'Webhook Category No Inbound');
    assert.equal(event.payload.email, `lead-${harness.namespace}@example.com`);
    assert.equal(event.payload.mailbox_email, `sender-${harness.namespace}@example.com`);
  } finally {
    await harness.cleanup();
  }
});

test('pause_campaign_and_defer_jobs emits campaign.paused webhook', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-campaign-pause'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Campaign Pause',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { error: pauseError } = await harness.supabase.rpc('pause_campaign_and_defer_jobs', {
      p_campaign_id: graph.campaignId,
    });
    assert.equal(pauseError, null);

    const event = await latestWebhookEvent(harness, 'campaign.paused', {
      campaignId: graph.campaignId,
    });
    assert.ok(event);
    assert.equal(event.payload.campaign_id, graph.campaignId);
  } finally {
    await harness.cleanup();
  }
});

test('campaign soft-delete does not emit campaign.stopped webhook', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-campaign-soft-delete'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Campaign Soft Delete',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { error: deleteError } = await harness.supabase
      .from('campaigns')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'stopped',
      } as never)
      .eq('id', graph.campaignId);
    assert.equal(deleteError, null);

    const event = await latestWebhookEvent(harness, 'campaign.stopped', {
      campaignId: graph.campaignId,
    });
    assert.equal(event, null);
  } finally {
    await harness.cleanup();
  }
});
