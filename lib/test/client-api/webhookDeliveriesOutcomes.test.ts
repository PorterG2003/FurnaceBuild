import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

const FAILED_DELIVERY_SELECT =
  'id, event_type, endpoint_url, status, response_status, error, created_at';

async function insertFailedDelivery(
  harness: ClientApiDbHarness,
  suffix: string,
  createdAt: string
): Promise<string> {
  const { data: event, error: eventError } = await harness.supabase
    .from('webhook_events')
    .insert({
      account_id: harness.accountId,
      campaign_id: null,
      event_type: 'lead.created',
      payload: { qa: suffix },
      dedupe_key: `${harness.namespace}-${suffix}`,
    } as never)
    .select('id')
    .single();
  assert.equal(eventError, null);
  harness.trackedWebhookEventIds.add(event.id);

  const { data: delivery, error: deliveryError } = await harness.supabase
    .from('webhook_deliveries')
    .insert({
      webhook_event_id: event.id,
      account_id: harness.accountId,
      campaign_id: null,
      endpoint_url: 'https://webhook-delivery.test/failed',
      event_type: 'lead.created',
      status: 'failed',
      attempt_count: 3,
      request_body: {},
      response_status: 502,
      response_body: 'Bad Gateway',
      error: 'HTTP 502',
      created_at: createdAt,
      updated_at: createdAt,
    } as never)
    .select('id')
    .single();
  assert.equal(deliveryError, null);
  harness.trackedWebhookDeliveryIds.add(delivery.id);
  return delivery.id;
}

test('failed webhook deliveries query returns all rows newest first', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliveries-fetch'),
  });

  try {
    await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Deliveries Fetch',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const older = new Date(Date.now() - 120_000).toISOString();
    const newer = new Date().toISOString();
    const olderId = await insertFailedDelivery(harness, 'older', older);
    const newerId = await insertFailedDelivery(harness, 'newer', newer);

    const { data: rows, error } = await harness.supabase
      .from('webhook_deliveries')
      .select(FAILED_DELIVERY_SELECT)
      .in('id', [olderId, newerId])
      .order('created_at', { ascending: false });

    assert.equal(error, null);
    assert.equal(rows?.length, 2);
    assert.equal(rows?.[0]?.id, newerId);
    assert.equal(rows?.[1]?.id, olderId);
  } finally {
    await harness.cleanup();
  }
});

test('failed webhook delivery count matches stored rows', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliveries-count'),
  });

  try {
    await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Deliveries Count',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const oneId = await insertFailedDelivery(harness, 'one', new Date().toISOString());
    const twoId = await insertFailedDelivery(harness, 'two', new Date().toISOString());

    const { count, error } = await harness.supabase
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .in('id', [oneId, twoId]);

    assert.equal(error, null);
    assert.equal(count, 2);
  } finally {
    await harness.cleanup();
  }
});

test('webhook_deliveries RLS allows owners and blocks members', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhook-deliveries-rls'),
  });

  try {
    await harness.campaignHarness.createCampaignGraph({
      name: 'Webhook Deliveries RLS',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });

    const deliveryId = await insertFailedDelivery(harness, 'rls', new Date().toISOString());
    await harness.ensureOwnerAuthUser();

    const publishableKey =
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim();
    assert.ok(publishableKey, 'publishable key required for RLS test');

    const ownerToken = await harness.getOwnerAccessToken();
    const ownerClient = createClient(harness.env.supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await ownerClient.auth.setSession({
      access_token: ownerToken,
      refresh_token: 'test-refresh-token',
    });

    const ownerResult = await ownerClient
      .from('webhook_deliveries')
      .select('id')
      .eq('id', deliveryId)
      .maybeSingle();
    assert.equal(ownerResult.error, null);
    assert.equal(ownerResult.data?.id, deliveryId);

    const member = await harness.createMemberUser();
    const memberClient = createClient(harness.env.supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await memberClient.auth.setSession({
      access_token: member.accessToken,
      refresh_token: 'test-refresh-token',
    });

    const memberResult = await memberClient
      .from('webhook_deliveries')
      .select('id')
      .eq('id', deliveryId)
      .maybeSingle();
    assert.equal(memberResult.error, null);
    assert.equal(memberResult.data, null);
  } finally {
    await harness.cleanup();
  }
});
