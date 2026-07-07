import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  cleanupCreatedCampaign,
  cloneFlow,
  linearFlowForApi,
  saveFlow,
} from './flowApiHelpers.js';

test('client api creates, builds, launches, and guards live campaign flows', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('campaign-builder'),
  });

  let createdCampaignId: string | null = null;

  try {
    const seedGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Seed Mailboxes',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `seed-${harness.namespace}@example.com`,
          displayName: 'Seed Sender',
        },
      ],
    });
    const apiKey = await harness.createApiKey();
    const mailboxId = seedGraph.mailboxIdsByKey.get('mailbox-1');
    assert.ok(mailboxId);

    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: 'API Built Campaign',
        mailbox_ids: [mailboxId],
      },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as {
      data: { id: string; status: string; owner_id: string; account_id: string };
    };
    createdCampaignId = createdBody.data.id;
    assert.equal(createdBody.data.status, 'draft');
    assert.equal(typeof createdBody.data.owner_id, 'string');
    assert.equal(createdBody.data.owner_id.length > 0, true);
    assert.equal(createdBody.data.account_id, harness.accountId);

    const flowPost = await saveFlow(harness, createdCampaignId, linearFlowForApi(), {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(flowPost.status, 200);
    const flowPostBody = await flowPost.json() as { data: { flow_revision?: string } };
    assert.equal(typeof flowPostBody.data.flow_revision, 'string');

    const leadCreate = await harness.request(`/v1/campaigns/${createdCampaignId}/leads`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        email: `builder-${harness.namespace}@example.com`,
        first_name: 'Builder',
        last_name: 'Test',
        custom_lead_data: {
          company: 'Furnace',
        },
      },
    });
    assert.equal(leadCreate.status, 201);

    const launched = await harness.request(`/v1/campaigns/${createdCampaignId}/launch`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {},
    });
    assert.equal(launched.status, 200);
    const launchedBody = await launched.json() as { data: { id: string; status: string; enrolled?: number } };
    assert.equal(launchedBody.data.status, 'running');
    assert.equal(launchedBody.data.enrolled, 1);

    const { data: enrollments, error: enrollmentsError } = await harness.supabase
      .from('enrollments')
      .select('id')
      .eq('campaign_id', createdCampaignId)
      .is('deleted_at', null);
    assert.equal(enrollmentsError, null);
    assert.equal((enrollments ?? []).length, 1);

    const contentEdit = cloneFlow(linearFlowForApi());
    const emailNode = contentEdit.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    if (!emailNode || emailNode.type !== 'email') {
      throw new Error('email node missing from example flow');
    }
    emailNode.data.variants[0]!.subject = 'Updated running subject';

    const contentUpdate = await saveFlow(harness, createdCampaignId, contentEdit, {
      method: 'PUT',
      apiKey: apiKey.secret,
    });
    assert.equal(contentUpdate.status, 200);

    const structuralEdit = cloneFlow(contentEdit);
    const structuralEmail = structuralEdit.nodes.find((node) => node.id === 'email-1');
    assert.ok(structuralEmail && structuralEmail.type === 'email');
    if (!structuralEmail || structuralEmail.type !== 'email') {
      throw new Error('email node missing from example flow');
    }
    structuralEmail.data.variants = structuralEmail.data.variants.slice(0, 1);
    const blocked = await saveFlow(harness, createdCampaignId, structuralEdit, {
      method: 'PUT',
      apiKey: apiKey.secret,
    });
    assert.equal(blocked.status, 403);
    const blockedBody = await blocked.json() as {
      error: { code: string; type: string };
    };
    assert.equal(blockedBody.error.code, 'flow_locked');
    assert.equal(blockedBody.error.type, 'permission_error');
  } finally {
    await cleanupCreatedCampaign(harness, createdCampaignId);
    await harness.cleanup();
  }
});
