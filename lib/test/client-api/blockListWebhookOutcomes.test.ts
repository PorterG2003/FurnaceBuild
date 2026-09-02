import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientApiDbHarness, createClientApiTestNamespace } from './harness.js';
import { ensureBlockListWebhookSchema } from './webhook-outcome-helpers.js';

async function loadLatestBlocklistEvent(
  harness: ClientApiDbHarness,
  eventType: 'blocklist.entry_added' | 'blocklist.entry_removed',
) {
  const { data, error } = await harness.supabase
    .from('webhook_events')
    .select('id, payload, event_type')
    .eq('account_id', harness.accountId)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(error, null);
  return data;
}

async function countBlocklistEvents(harness: ClientApiDbHarness) {
  const { count, error } = await harness.supabase
    .from('webhook_events')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', harness.accountId)
    .in('event_type', ['blocklist.entry_added', 'blocklist.entry_removed']);
  assert.equal(error, null);
  return count ?? 0;
}

test('POST /v1/block-list email emits one blocklist.entry_added', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('blocklist-add-email'),
  });

  try {
    if (!(await ensureBlockListWebhookSchema(harness.supabase, t))) return;
    await harness.campaignHarness.createCampaignGraph({
      name: `Block list ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const value = `blocked-${harness.namespace}@example.com`;

    const added = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { value, type: 'email', reason: 'manual' },
    });
    assert.equal(added.status, 201);

    const event = await loadLatestBlocklistEvent(harness, 'blocklist.entry_added');
    assert.ok(event);
    harness.trackedWebhookEventIds.add(event.id as string);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    assert.equal(payload.value, value);
    assert.equal(payload.type, 'email');
    assert.equal(payload.email, value);
    assert.equal(payload.reason, 'manual');
    assert.equal(payload.source, 'api');
  } finally {
    await harness.supabase.from('block_list').delete().eq('account_id', harness.accountId);
    await harness.supabase.from('webhook_events').delete().eq('account_id', harness.accountId);
    await harness.cleanup();
  }
});

test('POST /v1/block-list domain emits entry_added without requiring a lead', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('blocklist-add-domain'),
  });

  try {
    if (!(await ensureBlockListWebhookSchema(harness.supabase, t))) return;
    await harness.campaignHarness.createCampaignGraph({
      name: `Block list domain ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const value = `${harness.namespace}.example.com`;

    const added = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { value, type: 'domain' },
    });
    assert.equal(added.status, 201);

    const event = await loadLatestBlocklistEvent(harness, 'blocklist.entry_added');
    assert.ok(event);
    harness.trackedWebhookEventIds.add(event.id as string);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    assert.equal(payload.value, value);
    assert.equal(payload.type, 'domain');
    assert.equal(payload.source, 'api');
    assert.equal('email' in payload, false);
  } finally {
    await harness.supabase.from('block_list').delete().eq('account_id', harness.accountId);
    await harness.supabase.from('webhook_events').delete().eq('account_id', harness.accountId);
    await harness.cleanup();
  }
});

test('DELETE /v1/block-list/:id emits blocklist.entry_removed', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('blocklist-remove'),
  });

  try {
    if (!(await ensureBlockListWebhookSchema(harness.supabase, t))) return;
    await harness.campaignHarness.createCampaignGraph({
      name: `Block list remove ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const value = `removed-${harness.namespace}@example.com`;

    const added = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { value, type: 'email' },
    });
    assert.equal(added.status, 201);
    const addedBody = await added.json() as { data: { id: string } };

    const deleted = await harness.request(`/v1/block-list/${addedBody.data.id}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(deleted.status, 200);

    const event = await loadLatestBlocklistEvent(harness, 'blocklist.entry_removed');
    assert.ok(event);
    harness.trackedWebhookEventIds.add(event.id as string);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    assert.equal(payload.value, value);
    assert.equal(payload.type, 'email');
    assert.equal(payload.email, value);
  } finally {
    await harness.supabase.from('block_list').delete().eq('account_id', harness.accountId);
    await harness.supabase.from('webhook_events').delete().eq('account_id', harness.accountId);
    await harness.cleanup();
  }
});

test('duplicate POST of an existing block list entry does not emit a second event', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('blocklist-dup'),
  });

  try {
    if (!(await ensureBlockListWebhookSchema(harness.supabase, t))) return;
    await harness.campaignHarness.createCampaignGraph({
      name: `Block list dup ${harness.namespace}`,
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const value = `dup-${harness.namespace}@example.com`;
    const body = { value, type: 'email' as const };

    const first = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body,
    });
    assert.equal(first.status, 201);
    assert.equal(await countBlocklistEvents(harness), 1);

    const second = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body,
    });
    assert.equal(second.status, 200);
    assert.equal(await countBlocklistEvents(harness), 1);
  } finally {
    await harness.supabase.from('block_list').delete().eq('account_id', harness.accountId);
    await harness.supabase.from('webhook_events').delete().eq('account_id', harness.accountId);
    await harness.cleanup();
  }
});
