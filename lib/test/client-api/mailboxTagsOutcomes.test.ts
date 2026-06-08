import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('client api manages mailbox tags and filters mailboxes by tag', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('mailbox-tags'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Tagged Mailbox Campaign',
      status: 'draft',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const created = await harness.request('/v1/mailbox-tags', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { name: `Warmup-${harness.namespace}`, color: '#22C55E' },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { data: { id: string; name: string } };
    const tagId = createdBody.data.id;

    const patched = await harness.request(`/v1/mailbox-tags/${tagId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { name: `Warmup Pool-${harness.namespace}` },
    });
    assert.equal(patched.status, 200);

    const assignTag = await harness.request(`/v1/mailboxes/${mailboxId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { tag_ids: [tagId] },
    });
    assert.equal(assignTag.status, 200);
    const assignBody = await assignTag.json() as { data: { tags?: Array<{ id: string }> } };
    assert.ok(assignBody.data.tags?.some((tag) => tag.id === tagId));

    const filtered = await harness.request(`/v1/mailboxes?tag_ids=${tagId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(filtered.status, 200);
    const filteredBody = await filtered.json() as { data: Array<{ id: string }> };
    assert.ok(filteredBody.data.some((mailbox) => mailbox.id === mailboxId));

    const mailbox = await harness.request(`/v1/mailboxes/${mailboxId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(mailbox.status, 200);
    const mailboxBody = await mailbox.json() as { data: { tags?: Array<{ id: string }> } };
    assert.ok(mailboxBody.data.tags?.some((tag) => tag.id === tagId));

    const listed = await harness.request('/v1/mailbox-tags', { apiKey: apiKey.secret });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { data: Array<{ id: string }> };
    assert.ok(listedBody.data.some((tag) => tag.id === tagId));

    const deleted = await harness.request(`/v1/mailbox-tags/${tagId}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(deleted.status, 200);
  } finally {
    await harness.supabase
      .from('mailbox_tags')
      .delete()
      .eq('account_id', harness.accountId)
      .ilike('name', `%${harness.namespace}%`);
    await harness.cleanup();
  }
});
