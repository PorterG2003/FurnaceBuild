import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('client api manages campaign tags and filters campaigns by tag', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-tags'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Tagged Campaign',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const created = await harness.request('/v1/campaign-tags', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { name: `Enterprise-${harness.namespace}`, color: '#818CF8' },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { data: { id: string; name: string } };
    const tagId = createdBody.data.id;

    const patched = await harness.request(`/v1/campaign-tags/${tagId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { name: `Enterprise Plus-${harness.namespace}` },
    });
    assert.equal(patched.status, 200);

    const assignTag = await harness.request(`/v1/campaigns/${graph.campaignId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { tag_ids: [tagId] },
    });
    assert.equal(assignTag.status, 200);

    const filtered = await harness.request(`/v1/campaigns?tag_ids=${tagId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(filtered.status, 200);
    const filteredBody = await filtered.json() as { data: Array<{ id: string }> };
    assert.ok(filteredBody.data.some((campaign) => campaign.id === graph.campaignId));

    const listed = await harness.request('/v1/campaign-tags', { apiKey: apiKey.secret });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { data: Array<{ id: string }> };
    assert.ok(listedBody.data.some((tag) => tag.id === tagId));

    const deleted = await harness.request(`/v1/campaign-tags/${tagId}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(deleted.status, 200);
  } finally {
    await harness.cleanup();
  }
});
