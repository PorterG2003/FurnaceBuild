import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  cleanupCreatedCampaign,
  linearFlowForApi,
  linearFlowForFieldSyncTest,
  saveFlow,
} from './flowApiHelpers.js';
import { ensureWebhookInfrastructureSchema, latestWebhookEvent } from './webhook-outcome-helpers.js';

test('client api v1.4 POST /flow returns flow_revision and field_sync', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-v14-post'),
  });
  let createdCampaignId: string | null = null;
  try {
    const seedGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Flow V14 POST',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
      mailboxes: [{
        key: 'mailbox-1',
        emailAddress: `seed-${harness.namespace}@example.com`,
        displayName: 'Seed Sender',
      }],
    });
    const apiKey = await harness.createApiKey();
    createdCampaignId = seedGraph.campaignId;

    const flow = linearFlowForFieldSyncTest();

    const response = await saveFlow(harness, createdCampaignId, flow, {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      data: {
        flow: { nodes: Array<{ type: string; data: { customFieldKeys?: string[] } }> };
        flow_revision: string;
        field_sync: { declared_custom_added: string[] };
      };
    };
    assert.equal(typeof body.data.flow_revision, 'string');
    assert.ok(body.data.field_sync.declared_custom_added.includes('company'));
    const savedLeadSource = body.data.flow.nodes.find((node) => node.type === 'leadSource');
    assert.ok(savedLeadSource?.data.customFieldKeys?.includes('company'));
  } finally {
    await cleanupCreatedCampaign(harness, createdCampaignId);
    await harness.cleanup();
  }
});

test('client api v1.4 If-Match stale returns 412 flow_revision_conflict', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-v14-if-match'),
  });
  let createdCampaignId: string | null = null;
  try {
    const seedGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Flow V14 If-Match',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    createdCampaignId = seedGraph.campaignId;

    const first = await saveFlow(harness, createdCampaignId, linearFlowForApi(), {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(first.status, 200);

    const stale = await saveFlow(harness, createdCampaignId, linearFlowForApi(), {
      method: 'POST',
      apiKey: apiKey.secret,
      ifMatch: 'deadbeef'.repeat(8),
    });
    assert.equal(stale.status, 412);
    const staleBody = await stale.json() as {
      error: { code: string };
      current_flow_revision?: string;
    };
    assert.equal(staleBody.error.code, 'flow_revision_conflict');
    assert.equal(typeof staleBody.current_flow_revision, 'string');
  } finally {
    await cleanupCreatedCampaign(harness, createdCampaignId);
    await harness.cleanup();
  }
});

test('client api v1.4 PATCH /status emits campaign webhooks', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-v14-status-webhook'),
  });
  try {
    if (!(await ensureWebhookInfrastructureSchema(harness, t))) return;

    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Status Webhook',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const pause = await harness.request(`/v1/campaigns/${graph.campaignId}/status`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { status: 'paused' },
    });
    assert.equal(pause.status, 200);

    const pausedEvent = await latestWebhookEvent(harness, 'campaign.paused', {
      campaignId: graph.campaignId,
    });
    assert.ok(pausedEvent);
    assert.equal(pausedEvent.payload.campaign_id, graph.campaignId);

    const resume = await harness.request(`/v1/campaigns/${graph.campaignId}/status`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { status: 'running' },
    });
    assert.equal(resume.status, 200);
    const resumedEvent = await latestWebhookEvent(harness, 'campaign.resumed', {
      campaignId: graph.campaignId,
    });
    assert.ok(resumedEvent);

    const stop = await harness.request(`/v1/campaigns/${graph.campaignId}/status`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { status: 'stopped' },
    });
    assert.equal(stop.status, 200);
    const stoppedEvent = await latestWebhookEvent(harness, 'campaign.stopped', {
      campaignId: graph.campaignId,
    });
    assert.ok(stoppedEvent);
  } finally {
    await harness.cleanup();
  }
});

test('client api v1.4 list campaigns omits flow_data', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-v14-list'),
  });
  try {
    await harness.campaignHarness.createCampaignGraph({
      name: 'List Summary',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();
    const response = await harness.request('/v1/campaigns', {
      method: 'GET',
      apiKey: apiKey.secret,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    assert.ok(body.data.length > 0);
    for (const row of body.data) {
      assert.equal('flow_data' in row, false);
    }
  } finally {
    await harness.cleanup();
  }
});
