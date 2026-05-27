import assert from 'node:assert/strict';
import test from 'node:test';
import { processWebhookEventById } from '../../../amplify/functions/processWebhookEvent/handler.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

function installWebhookDeliveryFetchMock(status: number) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://webhook-delivery.test/')) {
      return new Response(status === 200 ? 'ok' : 'error', { status });
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function seedWebhookEvent(
  harness: ClientApiDbHarness,
  params: { endpointUrl: string; verified: boolean; enabledEvents: string[] },
  dedupeSuffix: string
) {
  const verifiedAt = params.verified ? new Date().toISOString() : null;
  const { error: accountError } = await harness.supabase
    .from('accounts')
    .update({
      webhook_url: params.endpointUrl,
      webhook_signing_secret: 'whsec_test',
      webhook_enabled_events: params.enabledEvents,
      webhook_url_verified_at: verifiedAt,
    } as never)
    .eq('id', harness.accountId);
  assert.equal(accountError, null);

  const { data: event, error: eventError } = await harness.supabase
    .from('webhook_events')
    .insert({
      account_id: harness.accountId,
      campaign_id: null,
      event_type: 'lead.created',
      payload: { email: `webhook-${harness.namespace}@example.com` },
      dedupe_key: `${harness.namespace}-${dedupeSuffix}`,
    } as never)
    .select('id')
    .single();
  assert.equal(eventError, null);
  harness.trackedWebhookEventIds.add(event.id);
  return event.id as string;
}

test('processWebhookEvent delivers to a verified endpoint', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(200);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-ok'),
  });

  try {
    const eventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/ok',
        verified: true,
        enabledEvents: ['lead.created'],
      },
      'ok'
    );

    await processWebhookEventById(eventId);

    const { data: delivery, error } = await harness.supabase
      .from('webhook_deliveries')
      .select('status, response_status, attempt_count, error')
      .eq('webhook_event_id', eventId)
      .maybeSingle();
    assert.equal(error, null);
    assert.equal(delivery?.status, 'delivered');
    assert.equal(delivery?.response_status, 200);
    assert.equal(delivery?.attempt_count, 1);
    assert.equal(delivery?.error, null);
    if (delivery?.id) {
      harness.trackedWebhookDeliveryIds.add(delivery.id);
    }
  } finally {
    await harness.cleanup();
  }
});

test('processWebhookEvent marks delivery failed after retries', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(502);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-fail'),
  });

  try {
    const eventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/fail',
        verified: true,
        enabledEvents: ['lead.created'],
      },
      'fail'
    );

    await processWebhookEventById(eventId);

    const { data: delivery, error } = await harness.supabase
      .from('webhook_deliveries')
      .select('status, response_status, attempt_count, error')
      .eq('webhook_event_id', eventId)
      .maybeSingle();
    assert.equal(error, null);
    assert.equal(delivery?.status, 'failed');
    assert.equal(delivery?.response_status, 502);
    assert.equal(delivery?.attempt_count, 3);
    assert.equal(delivery?.error, 'HTTP 502');
    if (delivery?.id) {
      harness.trackedWebhookDeliveryIds.add(delivery.id);
    }
  } finally {
    await harness.cleanup();
  }
});

test('processWebhookEvent skips unverified accounts and disabled event types', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(200);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-skip'),
  });

  try {
    const unverifiedEventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/skip-unverified',
        verified: false,
        enabledEvents: ['lead.created'],
      },
      'skip-unverified'
    );
    await processWebhookEventById(unverifiedEventId);

    const { data: unverifiedDelivery } = await harness.supabase
      .from('webhook_deliveries')
      .select('id')
      .eq('webhook_event_id', unverifiedEventId);
    assert.equal(unverifiedDelivery?.length ?? 0, 0);

    const disabledEventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/skip-disabled',
        verified: true,
        enabledEvents: ['email.sent'],
      },
      'skip-disabled'
    );

    await processWebhookEventById(disabledEventId);

    const { data: disabledDelivery } = await harness.supabase
      .from('webhook_deliveries')
      .select('id')
      .eq('webhook_event_id', disabledEventId);
    assert.equal(disabledDelivery?.length ?? 0, 0);
  } finally {
    await harness.cleanup();
  }
});

test('processWebhookEvent delivers batch completion events when enabled', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(200);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-batch'),
  });

  try {
    const { error: accountError } = await harness.supabase
      .from('accounts')
      .update({
        webhook_url: 'https://webhook-delivery.test/batch',
        webhook_signing_secret: 'whsec_test',
        webhook_enabled_events: ['lead.added_to_campaign.completed'],
        webhook_url_verified_at: new Date().toISOString(),
      } as never)
      .eq('id', harness.accountId);
    assert.equal(accountError, null);

    const { data: event, error: eventError } = await harness.supabase
      .from('webhook_events')
      .insert({
        account_id: harness.accountId,
        campaign_id: null,
        event_type: 'lead.added_to_campaign.completed',
        payload: {
          job_id: null,
          source: 'sync',
          operation: 'add_to_campaign',
          counts: { enrolled: 1 },
          errors: [],
        },
        dedupe_key: `${harness.namespace}-batch-completion`,
      } as never)
      .select('id')
      .single();
    assert.equal(eventError, null);
    harness.trackedWebhookEventIds.add(event.id);

    await processWebhookEventById(event.id as string);

    const { data: delivery } = await harness.supabase
      .from('webhook_deliveries')
      .select('status, response_status')
      .eq('webhook_event_id', event.id)
      .maybeSingle();
    assert.equal(delivery?.status, 'delivered');
    assert.equal(delivery?.response_status, 200);
  } finally {
    await harness.cleanup();
  }
});
