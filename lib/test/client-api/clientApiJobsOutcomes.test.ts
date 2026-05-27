import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
} from '../campaign/fixtures.js';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('POST /v1/jobs queues add_to_campaign job and GET /v1/jobs/{id} returns it', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('jobs-add'),
  });
  const email = `jobs-add-${harness.namespace}@example.com`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    await harness.campaignHarness.createCampaignGraph({
      name: 'Jobs Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });
    const targetGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Jobs Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const created = await harness.request('/v1/jobs', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        operation: 'add_to_campaign',
        campaign_id: targetGraph.campaignId,
        global_lead_ids: [globalLeadId],
      },
    });
    assert.equal(created.status, 202);
    const createdBody = await created.json() as { data: { id: string; status: string } };
    assert.equal(createdBody.data.status, 'queued');

    await processImportJobById(createdBody.data.id, { supabase: harness.supabase as never });

    const polled = await harness.request(`/v1/jobs/${createdBody.data.id}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(polled.status, 200);
    const polledBody = await polled.json() as { data: { status: string; result: Record<string, unknown> } };
    assert.equal(polledBody.data.status, 'completed');
  } finally {
    await harness.cleanup();
  }
});

test('POST /v1/jobs rejects invalid operation', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('jobs-invalid'),
  });

  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();
    const response = await harness.request('/v1/jobs', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { operation: 'not_a_real_operation' },
    });
    assert.equal(response.status, 400);
  } finally {
    await harness.cleanup();
  }
});

test('POST /v1/jobs returns 404 for job outside account on GET poll', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('jobs-404'),
  });

  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();
    const response = await harness.request(`/v1/jobs/${randomUUID()}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(response.status, 404);
  } finally {
    await harness.cleanup();
  }
});
