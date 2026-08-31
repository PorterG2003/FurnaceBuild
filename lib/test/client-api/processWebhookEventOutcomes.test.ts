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
  params: { endpointUrl: string; enabledEvents: string[] },
  dedupeSuffix: string
) {
  const { error: accountError } = await harness.supabase
    .from('accounts')
    .update({
      webhook_url: params.endpointUrl,
      webhook_signing_secret: 'whsec_test',
      webhook_enabled_events: params.enabledEvents,
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

test('processWebhookEvent delivers when endpoint URL is configured', async (t) => {
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

test('processWebhookEvent skips disabled event types', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(200);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-skip'),
  });

  try {
    const disabledEventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/skip-disabled',
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

test('processWebhookEvent skips reply.categorized when not enabled', async (t) => {
  const restoreFetch = installWebhookDeliveryFetchMock(200);
  t.after(restoreFetch);

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-categorized-skip'),
  });

  try {
    const { error: accountError } = await harness.supabase
      .from('accounts')
      .update({
        webhook_url: 'https://webhook-delivery.test/categorized-skip',
        webhook_signing_secret: 'whsec_test',
        webhook_enabled_events: ['email.sent'],
      } as never)
      .eq('id', harness.accountId);
    assert.equal(accountError, null);

    const { data: event, error: eventError } = await harness.supabase
      .from('webhook_events')
      .insert({
        account_id: harness.accountId,
        campaign_id: null,
        event_type: 'reply.categorized',
        payload: { thread_id: 'thread-1', category: 'Interested' },
        dedupe_key: `${harness.namespace}-categorized-skip`,
      } as never)
      .select('id')
      .single();
    assert.equal(eventError, null);
    harness.trackedWebhookEventIds.add(event!.id as string);

    await processWebhookEventById(event!.id as string);

    const { data: delivery } = await harness.supabase
      .from('webhook_deliveries')
      .select('id')
      .eq('webhook_event_id', event!.id);
    assert.equal(delivery?.length ?? 0, 0);
  } finally {
    await harness.cleanup();
  }
});

test('processWebhookEvent signs and delivers a truncated custom_fields payload', async (t) => {
  const bodies: string[] = [];
  const signatures: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://webhook-delivery.test/')) {
      bodies.push(typeof init?.body === 'string' ? init.body : String(init?.body ?? ''));
      signatures.push(String((init?.headers as Record<string, string> | undefined)?.['X-Furnace-Signature'] ?? ''));
      return new Response('ok', { status: 200 });
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-enriched'),
  });

  try {
    const { error: accountError } = await harness.supabase
      .from('accounts')
      .update({
        webhook_url: 'https://webhook-delivery.test/enriched',
        webhook_signing_secret: 'whsec_test',
        webhook_enabled_events: ['email.sent'],
      } as never)
      .eq('id', harness.accountId);
    assert.equal(accountError, null);

    const customFields: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      customFields[`field_${i}`] = 'x'.repeat(200);
    }

    const { data: event, error: eventError } = await harness.supabase
      .from('webhook_events')
      .insert({
        account_id: harness.accountId,
        campaign_id: null,
        event_type: 'email.sent',
        payload: {
          campaign_id: '00000000-0000-4000-8000-000000000099',
          email: 'lead@example.com',
          mailbox_email: 'sender@example.com',
          campaign_name: 'Example',
          custom_fields: customFields,
          custom_fields_truncated: true,
          body_text: 'Hi',
        },
        dedupe_key: `${harness.namespace}-enriched`,
      } as never)
      .select('id')
      .single();
    assert.equal(eventError, null);
    harness.trackedWebhookEventIds.add(event!.id as string);

    await processWebhookEventById(event!.id as string);

    assert.equal(bodies.length, 1);
    const parsed = JSON.parse(bodies[0]) as { data: { custom_fields_truncated?: boolean } };
    assert.equal(parsed.data.custom_fields_truncated, true);
    const { createHmac } = await import('node:crypto');
    const expected = `sha256=${createHmac('sha256', 'whsec_test').update(bodies[0]).digest('hex')}`;
    assert.equal(signatures[0], expected);
  } finally {
    await harness.cleanup();
  }
});

test('processWebhookEvent does not duplicate delivered customer POSTs', async (t) => {
  let postCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://webhook-delivery.test/')) {
      postCount += 1;
      return new Response('ok', { status: 200 });
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliver-dedupe'),
  });

  try {
    const eventId = await seedWebhookEvent(
      harness,
      {
        endpointUrl: 'https://webhook-delivery.test/dedupe',
        enabledEvents: ['lead.created'],
      },
      'dedupe',
    );

    await processWebhookEventById(eventId);
    await processWebhookEventById(eventId);

    assert.equal(postCount, 1);

    const { data: deliveries } = await harness.supabase
      .from('webhook_deliveries')
      .select('id, status')
      .eq('webhook_event_id', eventId);
    assert.equal(deliveries?.length ?? 0, 1);
    assert.equal(deliveries?.[0]?.status, 'delivered');
    if (deliveries?.[0]?.id) {
      harness.trackedWebhookDeliveryIds.add(deliveries[0].id as string);
    }
  } finally {
    await harness.cleanup();
  }
});
