import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

async function ensureHarnessReady(harness: ClientApiDbHarness) {
  // Ensures account/owner exist (createApiKey FK) and tracks cleanup via campaign graph.
  await harness.campaignHarness.createCampaignGraph({
    name: 'Account Settings Fixture',
    status: 'draft',
    flowKind: 'emailOnly',
    leads: [],
  });
}

test('client api webhook settings update and read persist enabled events', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('webhooks-settings'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const put = await harness.request('/v1/webhooks', {
      method: 'PUT',
      apiKey: apiKey.secret,
      body: {
        webhook_url: 'https://example.com/furnace-hooks',
        webhook_signing_secret: 'whsec_test',
        webhook_enabled_events: ['lead.created', 'email.sent'],
      },
    });
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as {
      data: {
        webhook_url: string;
        webhook_enabled_events: string[];
      };
    };
    assert.equal(putBody.data.webhook_url, 'https://example.com/furnace-hooks');
    assert.deepEqual(putBody.data.webhook_enabled_events, ['lead.created', 'email.sent']);

    const get = await harness.request('/v1/webhooks', { apiKey: apiKey.secret });
    assert.equal(get.status, 200);
    const getBody = (await get.json()) as {
      data: { webhook_url: string; webhook_enabled_events: string[] };
    };
    assert.equal(getBody.data.webhook_url, 'https://example.com/furnace-hooks');
    assert.deepEqual(getBody.data.webhook_enabled_events, ['lead.created', 'email.sent']);

    const blocked = await harness.request('/v1/webhooks', {
      method: 'PUT',
      apiKey: apiKey.secret,
      body: {
        webhook_url: 'https://localhost/hooks',
        webhook_enabled_events: [],
      },
    });
    assert.equal(blocked.status, 400);
    const blockedBody = (await blocked.json()) as { error: { code: string } };
    assert.equal(blockedBody.error.code, 'invalid_webhook_url');

    const unauthorized = await harness.request('/v1/webhooks', {
      apiKey: 'f_not_a_real_key',
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await harness.cleanup();
  }
});

test('client api api-key create returns secret once; revoke blocks subsequent calls', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('api-keys-crud'),
  });

  try {
    await ensureHarnessReady(harness);
    const bootstrap = await harness.createApiKey('bootstrap');
    const created = await harness.request('/v1/api-keys', {
      method: 'POST',
      apiKey: bootstrap.secret,
      body: { name: `mcp-${harness.namespace}` },
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
      data: { id: string; secret: string; secret_prefix: string };
    };
    assert.ok(createdBody.data.secret.startsWith('f_'));
    assert.ok(createdBody.data.id);
    harness.createdApiKeys.push({
      id: createdBody.data.id,
      secret: createdBody.data.secret,
      name: `mcp-${harness.namespace}`,
    });

    const listed = await harness.request('/v1/api-keys', { apiKey: bootstrap.secret });
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as {
      data: Array<{ id: string; secret?: string }>;
    };
    const listedRow = listedBody.data.find((row) => row.id === createdBody.data.id);
    assert.ok(listedRow);
    assert.equal(listedRow?.secret, undefined);

    const healthWithNew = await harness.request('/v1/campaigns?limit=1', {
      apiKey: createdBody.data.secret,
    });
    assert.equal(healthWithNew.status, 200);

    const revoked = await harness.request(`/v1/api-keys/${createdBody.data.id}`, {
      method: 'DELETE',
      apiKey: bootstrap.secret,
    });
    assert.equal(revoked.status, 200);

    const afterRevoke = await harness.request('/v1/campaigns?limit=1', {
      apiKey: createdBody.data.secret,
    });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await harness.cleanup();
  }
});

test('client api mailbox connect session create and get', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('mailbox-connect'),
  });

  try {
    await ensureHarnessReady(harness);
    const apiKey = await harness.createApiKey();
    const created = await harness.request('/v1/mailboxes/connect-sessions', {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
      data: {
        id: string;
        status: string;
        connect_url: string;
      };
    };
    assert.equal(createdBody.data.status, 'pending');
    assert.match(createdBody.data.connect_url, /mailbox_connect_session=/);

    const got = await harness.request(
      `/v1/mailboxes/connect-sessions/${createdBody.data.id}`,
      { apiKey: apiKey.secret },
    );
    assert.equal(got.status, 200);
    const gotBody = (await got.json()) as { data: { id: string; status: string } };
    assert.equal(gotBody.data.id, createdBody.data.id);
    assert.equal(gotBody.data.status, 'pending');
  } finally {
    await harness.cleanup();
  }
});
