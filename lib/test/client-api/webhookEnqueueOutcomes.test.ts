import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueWebhookEventById,
  reconcileStaleWebhookEnqueues,
} from '../../client-api/webhooks/enqueueWebhookEvent.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import { ensureWebhookInfrastructureSchema } from './webhook-outcome-helpers.js';

test('enqueueWebhookEventById claims sqs_enqueued_at once', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-enqueue-idempotent'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const { data: event, error } = await harness.supabase
      .from('webhook_events')
      .insert({
        account_id: harness.accountId,
        campaign_id: null,
        event_type: 'lead.created',
        payload: { email: `enqueue-${harness.namespace}@example.com` },
        dedupe_key: `${harness.namespace}-enqueue`,
      } as never)
      .select('id')
      .single();
    assert.equal(error, null);
    harness.trackedWebhookEventIds.add(event!.id as string);

    const first = await enqueueWebhookEventById(harness.supabase, event!.id as string);
    assert.equal(first.status, 'enqueued');

    const { data: claimedRow } = await harness.supabase
      .from('webhook_events')
      .select('sqs_enqueued_at')
      .eq('id', event!.id)
      .single();
    assert.ok(claimedRow?.sqs_enqueued_at);

    const second = await enqueueWebhookEventById(harness.supabase, event!.id as string);
    assert.equal(second.status, 'already_enqueued');
  } finally {
    await harness.cleanup();
  }
});

test('reconcileStaleWebhookEnqueues picks up unenqueued rows', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-reconcile'),
  });

  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: event, error } = await harness.supabase
      .from('webhook_events')
      .insert({
        account_id: harness.accountId,
        campaign_id: null,
        event_type: 'lead.updated',
        payload: { email: `reconcile-${harness.namespace}@example.com` },
        dedupe_key: `${harness.namespace}-reconcile`,
        created_at: staleCreatedAt,
      } as never)
      .select('id')
      .single();
    assert.equal(error, null);
    harness.trackedWebhookEventIds.add(event!.id as string);

    const enqueued = await reconcileStaleWebhookEnqueues(harness.supabase, {
      staleAfterMs: 60_000,
      enqueue: (eventId) => enqueueWebhookEventById(harness.supabase, eventId),
    });
    assert.ok(enqueued.includes(event!.id as string));
  } finally {
    await harness.cleanup();
  }
});
