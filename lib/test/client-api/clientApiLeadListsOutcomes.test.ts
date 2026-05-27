import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('client api manages saved lead lists and membership', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('lead-lists'),
  });

  try {
    const email = `list-${harness.namespace}@example.com`;
    const globalLeadId = hashGlobalLeadId(email);
    await harness.campaignHarness.createCampaignGraph({
      name: 'List Source Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [{ key: 'lead', email }],
    });
    const apiKey = await harness.createApiKey();

    const created = await harness.request('/v1/lead-lists', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: `Prospects-${harness.namespace}`,
        global_lead_ids: [globalLeadId],
      },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { data: { id: string; name: string } };
    const listId = createdBody.data.id;

    const listed = await harness.request('/v1/lead-lists', { apiKey: apiKey.secret });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { data: Array<{ id: string }> };
    assert.ok(listedBody.data.some((list) => list.id === listId));

    const people = await harness.request(`/v1/lead-lists/${listId}/people`, {
      apiKey: apiKey.secret,
    });
    assert.equal(people.status, 200);
    const peopleBody = await people.json() as { data: Array<{ global_lead_id?: string }> };
    assert.ok(peopleBody.data.some((row) => row.global_lead_id === globalLeadId));

    const addMember = await harness.request(`/v1/lead-lists/${listId}/members`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { global_lead_ids: [globalLeadId] },
    });
    assert.equal(addMember.status, 200);
    const addBody = await addMember.json() as { data: { added: number; skippedAlreadyMember: number } };
    assert.equal(addBody.data.added, 0);
    assert.equal(addBody.data.skippedAlreadyMember, 1);

    const removed = await harness.request(`/v1/lead-lists/${listId}/members`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
      body: { global_lead_ids: [globalLeadId] },
    });
    assert.equal(removed.status, 200);
    const removedBody = await removed.json() as { data: { removed: number } };
    assert.equal(removedBody.data.removed, 1);

    const deleted = await harness.request(`/v1/lead-lists/${listId}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(deleted.status, 200);
  } finally {
    await harness.cleanup();
  }
});
