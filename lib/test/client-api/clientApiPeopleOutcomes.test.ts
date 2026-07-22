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

test('client api lists people and returns global_lead_id on campaign leads', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('people'),
  });

  try {
    const email = `people-${harness.namespace}@example.com`;
    const globalLeadId = hashGlobalLeadId(email);
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'People Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [{ key: 'lead', email }],
    });
    const apiKey = await harness.createApiKey();

    const leads = await harness.request(`/v1/campaigns/${graph.campaignId}/leads`, {
      apiKey: apiKey.secret,
    });
    assert.equal(leads.status, 200);
    const leadsBody = await leads.json() as { data: Array<{ global_lead_id?: string; email: string }> };
    assert.equal(leadsBody.data.length, 1);
    assert.equal(leadsBody.data[0]?.global_lead_id, globalLeadId);
    assert.equal(leadsBody.data[0]?.email, email);

    const people = await harness.request('/v1/people', { apiKey: apiKey.secret });
    assert.equal(people.status, 200);
    const peopleBody = await people.json() as {
      data: Array<{ global_lead_id?: string; latest_activity_at?: string | null; total_count?: number }>;
      total_count: number;
    };
    assert.ok(peopleBody.total_count >= 1);
    const personRow = peopleBody.data.find((row) => row.global_lead_id === globalLeadId);
    assert.ok(personRow);
    assert.equal('total_count' in personRow, false);
    assert.ok('latest_activity_at' in personRow);

    const person = await harness.request(`/v1/people/${globalLeadId}`, { apiKey: apiKey.secret });
    assert.equal(person.status, 200);
    const personBody = await person.json() as {
      data: { person: { global_lead_id: string; latest_activity_at?: string | null }; memberships: unknown[] };
    };
    assert.equal(personBody.data.person.global_lead_id, globalLeadId);
    assert.ok('latest_activity_at' in personBody.data.person);
    assert.ok(personBody.data.memberships.length >= 1);

    const patched = await harness.request(`/v1/people/${globalLeadId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { first_name: 'Updated', not_a_field: 'ignore-me' },
    });
    assert.equal(patched.status, 200);
    const patchedBody = await patched.json() as { data: { first_name?: string; not_a_field?: string } };
    assert.equal(patchedBody.data.first_name, 'Updated');
    assert.equal('not_a_field' in patchedBody.data, false);
  } finally {
    await harness.cleanup();
  }
});
