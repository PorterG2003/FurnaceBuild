import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER,
  CAMPAIGN_FLOW_EXAMPLE_DATASENDER,
  type CampaignFlowData,
} from '../../campaigns/flow/index.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import {
  assertFlowDryRunShape,
  assertFlowSaveShape,
  appendEmailAfterLeaf,
  cleanupCreatedCampaign,
  cloneFlow,
  countFlowVersions,
  countSyncedNodes,
  createForeignAccountApiKey,
  getFlowRevision,
  launchDraftCampaign,
  linearFlowForApi,
  linearFlowForFieldSyncTest,
  loadCampaignFlowFromDb,
  loadLatestFlowVersion,
  patchFlowNode,
  saveFlow,
  validateFlow,
} from './flowApiHelpers.js';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
} from '../campaign/fixtures.js';

async function setupDraftCampaign(harness: ClientApiDbHarness): Promise<{
  campaignId: string;
  apiKey: string;
}> {
  const seedGraph = await harness.campaignHarness.createCampaignGraph({
    name: 'Flow Outcomes Draft',
    status: 'draft',
    flowKind: 'emailOnly',
    leads: [],
    mailboxes: [{
      key: 'mailbox-1',
      emailAddress: `seed-${harness.namespace}@example.com`,
      displayName: 'Seed Sender',
    }],
  });
  const apiKeyRecord = await harness.createApiKey();
  return { campaignId: seedGraph.campaignId, apiKey: apiKeyRecord.secret };
}

async function setupRunningCampaign(harness: ClientApiDbHarness): Promise<{
  campaignId: string;
  apiKey: string;
}> {
  const { campaignId, apiKey } = await setupDraftCampaign(harness);
  const flow = linearFlowForApi();
  const saved = await saveFlow(harness, campaignId, flow, { apiKey });
  assert.equal(saved.status, 200);
  await launchDraftCampaign(harness, campaignId, apiKey, {
    email: `running-${harness.namespace}@example.com`,
    first_name: 'Running',
    custom_lead_data: { company: 'Furnace' },
  });
  return { campaignId, apiKey };
}

async function setupStoppedCampaign(harness: ClientApiDbHarness): Promise<{
  campaignId: string;
  apiKey: string;
}> {
  const setup = await setupRunningCampaign(harness);
  const stopped = await harness.request(`/v1/campaigns/${setup.campaignId}/status`, {
    method: 'PATCH',
    apiKey: setup.apiKey,
    body: { status: 'stopped' },
  });
  assert.equal(stopped.status, 200);
  const stoppedBody = await stopped.json() as { data: { status: string } };
  assert.equal(stoppedBody.data.status, 'stopped');
  return setup;
}

test('client api GET /v1/flow-templates returns template list', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-templates'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const response = await harness.request('/v1/flow-templates', {
      method: 'GET',
      apiKey: setup.apiKey,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      data: Array<{ id: string; name: string; flow: { nodes: unknown[] } }>;
    };
    assert.ok(body.data.length > 0);
    for (const template of body.data) {
      assert.equal(typeof template.id, 'string');
      assert.equal(typeof template.name, 'string');
      assert.ok(Array.isArray(template.flow.nodes));
    }
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api GET /flow returns saved flow and matching flow_revision', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-get'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = linearFlowForApi();
    const saved = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as { data: { flow_revision: string } };
    assertFlowSaveShape(savedBody.data);

    const fetched = await harness.request(`/v1/campaigns/${campaignId}/flow`, {
      method: 'GET',
      apiKey: setup.apiKey,
    });
    assert.equal(fetched.status, 200);
    const fetchedBody = await fetched.json() as {
      data: { flow_revision: string; nodes: unknown[]; edges: unknown[] };
    };
    assert.equal(fetchedBody.data.flow_revision, savedBody.data.flow_revision);
    assert.equal(fetchedBody.data.nodes.length, flow.nodes.length);
    assert.equal(fetchedBody.data.edges.length, flow.edges.length);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api GET /campaigns/:id includes full flow and flow_revision', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-campaign-detail'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });

    const response = await harness.request(`/v1/campaigns/${campaignId}`, {
      method: 'GET',
      apiKey: setup.apiKey,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      data: { flow_data: { nodes: unknown[] }; flow_revision: string };
    };
    assert.ok(Array.isArray(body.data.flow_data.nodes));
    assert.equal(typeof body.data.flow_revision, 'string');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow success returns save shape and lifecycle allowed', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-post-success'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = linearFlowForFieldSyncTest();
    const response = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: unknown };
    assertFlowSaveShape(body.data);
    const data = body.data;
    assert.equal(data.lifecycle.allowed, true);
    assert.ok(data.field_sync.declared_custom_added.includes('company'));
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PUT /flow matches POST semantics', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-put-alias'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = linearFlowForApi();
    const post = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey, method: 'POST' });
    assert.equal(post.status, 200);
    const postBody = await post.json() as { data: { flow_revision: string } };

    const updated = cloneFlow(flow);
    const emailNode = updated.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'PUT alias subject';

    const put = await saveFlow(harness, campaignId, updated, {
      apiKey: setup.apiKey,
      method: 'PUT',
      ifMatch: postBody.data.flow_revision,
    });
    assert.equal(put.status, 200);
    const putBody = await put.json() as { data: unknown };
    assertFlowSaveShape(putBody.data);
    assert.notEqual((putBody.data as { flow_revision: string }).flow_revision, postBody.data.flow_revision);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow?dry_run=true does not persist flow or versions', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-dry-run'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const beforeFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const beforeVersions = await countFlowVersions(harness, campaignId);

    const response = await saveFlow(harness, campaignId, linearFlowForApi(), {
      apiKey: setup.apiKey,
      dryRun: true,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: unknown };
    assertFlowDryRunShape(body.data);

    const afterFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const afterVersions = await countFlowVersions(harness, campaignId);
    assert.deepEqual(afterFlow, beforeFlow);
    assert.equal(afterVersions, beforeVersions);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow:validate returns 200 with warnings for empty draft flow', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-validate-invalid'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const response = await validateFlow(harness, campaignId, { nodes: [], edges: [] }, setup.apiKey);
    assert.equal(response.status, 200);
    const body = await response.json() as { data: unknown };
    assertFlowDryRunShape(body.data);
    assert.equal(body.data.allowed, true);
    assert.equal(body.data.blocking_issues.length, 0);
    assert.ok(body.data.warnings.length > 0);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow:validate returns allowed true for valid linear flow', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-validate-valid'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const response = await validateFlow(harness, campaignId, linearFlowForApi(), setup.apiKey);
    assert.equal(response.status, 200);
    const body = await response.json() as { data: unknown };
    assertFlowDryRunShape(body.data);
    assert.equal((body.data as { allowed: boolean }).allowed, true);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow saves empty draft flow with validation warnings', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-invalid-write'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const response = await saveFlow(harness, campaignId, { nodes: [], edges: [] }, { apiKey: setup.apiKey });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: unknown };
    assertFlowSaveShape(body.data);
    assert.equal(body.data.validation.blocking_issues.length, 0);
    assert.ok(body.data.validation.warnings.length > 0);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    assert.ok(dbFlow);
    assert.ok(Array.isArray(dbFlow.nodes));
    assert.ok(Array.isArray(dbFlow.edges));
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api If-Match happy path updates flow_revision', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-if-match-success'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const first = await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as { data: { flow_revision: string } };

    const secondFlow = linearFlowForApi();
    const emailNode = secondFlow.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'If-Match success subject';

    const second = await saveFlow(harness, campaignId, secondFlow, {
      apiKey: setup.apiKey,
      ifMatch: firstBody.data.flow_revision,
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json() as { data: { flow_revision: string } };
    assert.notEqual(secondBody.data.flow_revision, firstBody.data.flow_revision);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api sequential saves without If-Match both succeed', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-no-if-match'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const first = await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    assert.equal(first.status, 200);
    const secondFlow = linearFlowForApi();
    const emailNode = secondFlow.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'No If-Match subject';
    const second = await saveFlow(harness, campaignId, secondFlow, { apiKey: setup.apiKey });
    assert.equal(second.status, 200);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow persists flow_data and campaign_flow_versions', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-persistence'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const beforeVersions = await countFlowVersions(harness, campaignId);
    const flow = linearFlowForApi();
    const response = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { flow: CampaignFlowData } };
    assertFlowSaveShape(body.data);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    assert.ok(dbFlow);
    const dbLeadSource = dbFlow.nodes.find((node) => node.type === 'leadSource');
    assert.ok(dbLeadSource?.data.customFieldKeys?.includes('company'));
    const dbEmail = dbFlow.nodes.find((node) => node.id === 'email-1');
    const flowEmail = flow.nodes.find((node) => node.id === 'email-1');
    assert.ok(dbEmail && dbEmail.type === 'email');
    assert.ok(flowEmail && flowEmail.type === 'email');
    assert.equal(dbEmail.data.variants[0]?.subject, flowEmail.data.variants[0]?.subject);

    const version = await loadLatestFlowVersion(harness, campaignId);
    assert.ok(version);
    assert.equal(version.change_source, 'client_api');
    assert.equal(await countFlowVersions(harness, campaignId), beforeVersions + 1);

    const secondFlow = cloneFlow(flow);
    const emailNode = secondFlow.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'Second save subject';
    const second = await saveFlow(harness, campaignId, secondFlow, { apiKey: setup.apiKey });
    assert.equal(second.status, 200);
    assert.equal(await countFlowVersions(harness, campaignId), beforeVersions + 2);

    const syncedNodes = await countSyncedNodes(harness, campaignId);
    assert.equal(syncedNodes, flow.nodes.length);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /campaigns with flow persists initial flow', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-create-with-flow'),
  });
  let campaignId: string | null = null;
  try {
    const seedGraph = await harness.campaignHarness.createCampaignGraph({
      name: 'Create With Flow Mailboxes',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
      mailboxes: [{
        key: 'mailbox-1',
        emailAddress: `create-${harness.namespace}@example.com`,
        displayName: 'Create Sender',
      }],
    });
    const apiKey = await harness.createApiKey();
    const mailboxId = seedGraph.mailboxIdsByKey.get('mailbox-1');
    assert.ok(mailboxId);

    const created = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: 'Created With Flow',
        mailbox_ids: [mailboxId],
        flow: linearFlowForApi(),
      },
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { data: { id: string; flow_revision: string } };
    campaignId = createdBody.data.id;
    assert.equal(typeof createdBody.data.flow_revision, 'string');

    const fetched = await harness.request(`/v1/campaigns/${campaignId}/flow`, {
      method: 'GET',
      apiKey: apiKey.secret,
    });
    assert.equal(fetched.status, 200);
    const fetchedBody = await fetched.json() as { data: { nodes: unknown[]; flow_revision: string } };
    assert.ok(fetchedBody.data.nodes.length > 0);
    assert.equal(typeof fetchedBody.data.flow_revision, 'string');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /campaigns creates draft campaign when flow is empty (warnings only)', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-create-invalid'),
  });
  let campaignId: string | null = null;
  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();
    const campaignName = `Empty Flow Create ${harness.namespace}`;
    const response = await harness.request('/v1/campaigns', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        name: campaignName,
        flow: { nodes: [], edges: [] },
      },
    });
    assert.equal(response.status, 201);
    const body = await response.json() as { data: { id: string; status: string } };
    campaignId = body.data.id;
    assert.equal(body.data.status, 'draft');

    const { data: campaigns } = await harness.supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId);
    assert.equal((campaigns ?? []).length, 1);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api lead-fields read and write sync flow custom fields', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-lead-fields'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const saved = await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    assert.equal(saved.status, 200);

    const initial = await harness.request(`/v1/campaigns/${campaignId}/lead-fields`, {
      method: 'GET',
      apiKey: setup.apiKey,
    });
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { data: { custom: string[]; standard: string[] } };
    assert.ok(initialBody.data.custom.includes('company'));
    assert.ok(initialBody.data.standard.includes('first_name'));

    const added = await harness.request(`/v1/campaigns/${campaignId}/lead-fields`, {
      method: 'POST',
      apiKey: setup.apiKey,
      body: { key: 'industry' },
    });
    assert.equal(added.status, 200);

    const after = await harness.request(`/v1/campaigns/${campaignId}/lead-fields`, {
      method: 'GET',
      apiKey: setup.apiKey,
    });
    assert.equal(after.status, 200);
    const afterBody = await after.json() as { data: { custom: string[] } };
    assert.ok(afterBody.data.custom.includes('industry'));

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const leadSource = dbFlow?.nodes.find((node) => node.type === 'leadSource');
    assert.ok(leadSource?.data.customFieldKeys?.includes('industry'));
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api lead create requires custom fields declared in flow', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-lead-validation'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });

    const missing = await harness.request(`/v1/campaigns/${campaignId}/leads`, {
      method: 'POST',
      apiKey: setup.apiKey,
      body: {
        email: `missing-custom-${harness.namespace}@example.com`,
        first_name: 'Missing',
      },
    });
    assert.equal(missing.status, 400);
    const missingBody = await missing.json() as { error: { code: string } };
    assert.equal(missingBody.error.code, 'missing_custom_field');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PATCH /flow/nodes/{nodeId} updates running email content', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-patch-running'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupRunningCampaign(harness);
    campaignId = setup.campaignId;
    const beforeRevision = await getFlowRevision(harness, campaignId, setup.apiKey);

    const emailNode = linearFlowForApi().nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    const nextVariants = cloneFlow(emailNode.data.variants);
    nextVariants[0]!.subject = 'Patched running subject';

    const patched = await patchFlowNode(harness, campaignId, 'email-1', {
      variants: nextVariants,
    }, setup.apiKey);
    assert.equal(patched.status, 200);
    const patchedBody = await patched.json() as { data: { flow_revision: string } };
    assertFlowSaveShape(patchedBody.data);
    assert.notEqual(patchedBody.data.flow_revision, beforeRevision);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const dbEmail = dbFlow?.nodes.find((node) => node.id === 'email-1');
    assert.ok(dbEmail && dbEmail.type === 'email');
    assert.equal(dbEmail.data.variants[0]?.subject, 'Patched running subject');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PATCH node on leadSource returns 200 while running', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-patch-lead-source'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupRunningCampaign(harness);
    campaignId = setup.campaignId;
    const patched = await patchFlowNode(harness, campaignId, 'leadSource-1', {
      customFieldKeys: ['company', 'title'],
    }, setup.apiKey);
    assert.equal(patched.status, 200);
    const body = await patched.json() as { data: { flow_revision: string } };
    assert.ok(body.data.flow_revision);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PATCH unknown node returns 404 node_not_found', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-patch-missing-node'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    const patched = await patchFlowNode(harness, campaignId, 'missing-node', { label: 'Nope' }, setup.apiKey);
    assert.equal(patched.status, 404);
    const body = await patched.json() as { error: { code: string } };
    assert.equal(body.error.code, 'node_not_found');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PATCH node without data returns 400 validation_error', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-patch-no-data'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    const patched = await harness.request(`/v1/campaigns/${campaignId}/flow/nodes/email-1`, {
      method: 'PATCH',
      apiKey: setup.apiKey,
      body: {},
    });
    assert.equal(patched.status, 400);
    const body = await patched.json() as { error: { code: string } };
    assert.equal(body.error.code, 'validation_error');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow structural edit on running returns 403 flow_locked', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-running-structural'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupRunningCampaign(harness);
    campaignId = setup.campaignId;
    const structural = cloneFlow(linearFlowForApi());
    structural.edges.pop();
    const response = await saveFlow(harness, campaignId, structural, { apiKey: setup.apiKey });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'flow_locked');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api POST /flow node add on running returns 403 flow_locked', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-running-node-add'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupRunningCampaign(harness);
    campaignId = setup.campaignId;
    const withNode = cloneFlow(linearFlowForApi());
    withNode.nodes.push({
      id: 'email-extra',
      type: 'email',
      position: { x: 900, y: 0 },
      data: {
        label: 'Extra',
        priority: false,
        variants: [{
          id: crypto.randomUUID(),
          label: 'A',
          subject: 'Extra',
          template: 'Extra body',
          isActive: true,
          order: 0,
        }],
      },
    });
    withNode.edges.push({ id: 'e-extra', source: 'email-2', target: 'email-extra' });
    const response = await saveFlow(harness, campaignId, withNode, { apiKey: setup.apiKey });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'flow_locked');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api paused campaign allows content and structural edits', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-paused-lock'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupRunningCampaign(harness);
    campaignId = setup.campaignId;
    const paused = await harness.request(`/v1/campaigns/${campaignId}/status`, {
      method: 'PATCH',
      apiKey: setup.apiKey,
      body: { status: 'paused' },
    });
    assert.equal(paused.status, 200);

    const content = cloneFlow(linearFlowForApi());
    const emailNode = content.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'Paused content edit';
    const contentResponse = await saveFlow(harness, campaignId, content, { apiKey: setup.apiKey });
    assert.equal(contentResponse.status, 200);

    const structural = cloneFlow(content);
    const edgeCountBefore = structural.edges.length;
    structural.edges.pop();
    const structuralResponse = await saveFlow(harness, campaignId, structural, { apiKey: setup.apiKey });
    assert.equal(structuralResponse.status, 200);
    const structuralBody = await structuralResponse.json() as { data: unknown };
    assertFlowSaveShape(structuralBody.data);
    assert.equal(structuralBody.data.change_kind, 'structural');

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    assert.ok(dbFlow);
    assert.equal(dbFlow.edges.length, edgeCountBefore - 1);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api multi-variant flow persists variant B subject mutation', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-multi-variant'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = linearFlowForApi();
    await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });

    const updated = cloneFlow(flow);
    const emailNode = updated.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[1]!.subject = 'Variant B updated via API';
    const response = await saveFlow(harness, campaignId, updated, { apiKey: setup.apiKey });
    assert.equal(response.status, 200);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const dbEmail = dbFlow?.nodes.find((node) => node.id === 'email-1');
    assert.ok(dbEmail && dbEmail.type === 'email');
    assert.equal(dbEmail.data.variants[1]?.subject, 'Variant B updated via API');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api dataSender flow validates and saves', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-datasender'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = cloneFlow(CAMPAIGN_FLOW_EXAMPLE_DATASENDER);
    const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
    assert.ok(leadSource);
    leadSource!.data.customFieldKeys = ['company'];

    const validated = await validateFlow(harness, campaignId, flow, setup.apiKey);
    assert.equal(validated.status, 200);
    const validatedBody = await validated.json() as { data: { allowed: boolean } };
    assert.equal(validatedBody.data.allowed, true);

    const saved = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    assert.equal(saved.status, 200);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api categorizer flow validates and allows live categorizer patch', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-categorizer'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const flow = cloneFlow(CAMPAIGN_FLOW_EXAMPLE_CATEGORIZER);
    const leadSource = flow.nodes.find((node) => node.type === 'leadSource');
    assert.ok(leadSource);
    leadSource!.data.customFieldKeys = ['company'];

    const validated = await validateFlow(harness, campaignId, flow, setup.apiKey);
    assert.equal(validated.status, 200);
    const validatedBody = await validated.json() as { data: { allowed: boolean } };
    assert.equal(validatedBody.data.allowed, true);

    await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    await launchDraftCampaign(harness, campaignId, setup.apiKey, {
      email: `categorizer-${harness.namespace}@example.com`,
      first_name: 'Cat',
      custom_lead_data: { company: 'Furnace' },
    });

    const patched = await patchFlowNode(harness, campaignId, 'aiCategorizer-1', {
      use_ai: false,
    }, setup.apiKey);
    assert.equal(patched.status, 200);
    const body = await patched.json() as { data: { flow_revision: string } };
    assertFlowSaveShape(body.data);
    assert.ok(body.data.flow_revision);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const categorizer = dbFlow?.nodes.find((node) => node.id === 'aiCategorizer-1');
    assert.ok(categorizer && categorizer.type === 'aiCategorizer');
    assert.equal(categorizer.data.use_ai, false);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api PUT /flow append on paused returns 200 and reactivated_count', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-paused-append'),
  });
  let campaignId: string | null = null;
  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Paused Append Reactivation',
      status: 'paused',
      flowKind: 'emailWaitEmail',
      leads: [
        buildCampaignLead({
          key: 'completed-leaf',
          email: `completed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'completed',
            currentFlowNodeId: 'email-2',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'email-2-sent',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
              sentAt: new Date(Date.now() - 60_000).toISOString(),
            }),
          ],
        }),
      ],
      mailboxes: [{
        key: 'mailbox-1',
        emailAddress: `seed-${harness.namespace}@example.com`,
        displayName: 'Seed Sender',
      }],
    });
    campaignId = graph.campaignId;
    const apiKey = await harness.createApiKey();

    const currentFlow = await loadCampaignFlowFromDb(harness, campaignId);
    assert.ok(currentFlow);
    const outgoingFromLeaf = currentFlow.edges.filter((edge) => edge.source === 'email-2');
    assert.equal(outgoingFromLeaf.length, 0, 'precondition: email-2 must be a former leaf');

    const appendedFlow = appendEmailAfterLeaf(currentFlow, 'email-2', 'email-append-1');
    const response = await saveFlow(harness, campaignId, appendedFlow, {
      method: 'PUT',
      apiKey: apiKey.secret,
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { reactivated_count: number } };
    assertFlowSaveShape(body.data);
    assert.equal(body.data.reactivated_count, 1);

    const completedEnrollmentId = graph.leadsByKey.get('completed-leaf')!.enrollmentId!;
    const { data: enrollment, error } = await harness.supabase
      .from('enrollments')
      .select('state, current_node_id')
      .eq('id', completedEnrollmentId)
      .single();
    assert.equal(error, null);
    assert.equal(enrollment?.state, 'active');
    assert.equal(
      enrollment?.current_node_id,
      graph.nodeIdsByFlowNodeId.get('email-2'),
    );
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api stopped campaign blocks POST, PUT, and PATCH flow writes', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-stopped-locked'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupStoppedCampaign(harness);
    campaignId = setup.campaignId;
    const flow = cloneFlow(linearFlowForApi());
    const emailNode = flow.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.subject = 'Stopped content edit';

    const post = await saveFlow(harness, campaignId, flow, {
      method: 'POST',
      apiKey: setup.apiKey,
    });
    assert.equal(post.status, 403);
    const postBody = await post.json() as { error: { code: string } };
    assert.equal(postBody.error.code, 'flow_locked');

    const put = await saveFlow(harness, campaignId, flow, {
      method: 'PUT',
      apiKey: setup.apiKey,
    });
    assert.equal(put.status, 403);
    const putBody = await put.json() as { error: { code: string } };
    assert.equal(putBody.error.code, 'flow_locked');

    const patched = await patchFlowNode(harness, campaignId, 'email-1', {
      variants: emailNode.data.variants,
    }, setup.apiKey);
    assert.equal(patched.status, 403);
    const patchBody = await patched.json() as { error: { code: string } };
    assert.equal(patchBody.error.code, 'flow_locked');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api smartlead campaigns reject flow writes', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-smartlead'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const { error } = await harness.supabase
      .from('campaigns')
      .update({ source: 'smartlead' } as never)
      .eq('id', campaignId);
    assert.equal(error, null);

    const response = await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'smartlead_read_only');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api deleted campaigns reject flow writes', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-deleted'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    const { error } = await harness.supabase
      .from('campaigns')
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq('id', campaignId);
    assert.equal(error, null);

    const response = await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'campaign_deleted');
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api unknown campaign id returns 404 campaign_not_found', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-unknown-campaign'),
  });
  try {
    await harness.ensureOwnerAuthUser();
    const apiKey = await harness.createApiKey();
    const response = await saveFlow(
      harness,
      crypto.randomUUID(),
      linearFlowForApi(),
      { apiKey: apiKey.secret },
    );
    assert.equal(response.status, 404);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'campaign_not_found');
  } finally {
    await harness.cleanup();
  }
});

test('client api foreign account cannot read or write campaign flow', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-cross-account'),
  });
  let campaignId: string | null = null;
  const foreign = await createForeignAccountApiKey(harness);
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;
    await saveFlow(harness, campaignId, linearFlowForApi(), { apiKey: setup.apiKey });

    const read = await harness.request(`/v1/campaigns/${campaignId}/flow`, {
      method: 'GET',
      apiKey: foreign.apiKeySecret,
    });
    assert.equal(read.status, 404);

    const write = await saveFlow(harness, campaignId, linearFlowForApi(), {
      apiKey: foreign.apiKeySecret,
    });
    assert.equal(write.status, 404);
  } finally {
    await foreign.cleanup();
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});

test('client api template-only email variants persist empty body_html and still render copy', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('flow-template-only-body'),
  });
  let campaignId: string | null = null;
  try {
    const setup = await setupDraftCampaign(harness);
    campaignId = setup.campaignId;

    const flow = linearFlowForApi();
    const emailNode = flow.nodes.find((node) => node.id === 'email-1');
    assert.ok(emailNode && emailNode.type === 'email');
    emailNode.data.variants[0]!.template = 'Hey {{first_name}}, figured this might help.';
    delete (emailNode.data.variants[0] as { body_html?: string }).body_html;
    delete (emailNode.data.variants[0] as { body_text?: string }).body_text;

    const saved = await saveFlow(harness, campaignId, flow, { apiKey: setup.apiKey });
    assert.equal(saved.status, 200);

    const dbFlow = await loadCampaignFlowFromDb(harness, campaignId);
    const dbEmail = dbFlow?.nodes.find((node) => node.id === 'email-1');
    assert.ok(dbEmail && dbEmail.type === 'email');
    const variant = dbEmail.data.variants[0];
    assert.ok(variant);
    assert.equal(variant.body_html, '');
    assert.equal(variant.template, 'Hey {{first_name}}, figured this might help.');

    const { buildCampaignEmailContent } = await import('../../email/buildCampaignEmailContent.js');
    const rendered = buildCampaignEmailContent(
      {
        subject: variant.subject,
        body_html: variant.body_html,
        body_text: variant.body_text,
        template: variant.template,
        editor_mode: variant.editor_mode,
      },
      { first_name: 'Casey' },
      { deterministic: true }
    );
    assert.equal(rendered.bodyMerged, 'Hey Casey, figured this might help.');
    assert.match(rendered.bodyText ?? '', /Hey Casey, figured this might help/);
  } finally {
    await cleanupCreatedCampaign(harness, campaignId);
    await harness.cleanup();
  }
});
