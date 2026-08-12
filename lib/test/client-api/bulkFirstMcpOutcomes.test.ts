import assert from 'node:assert/strict';
import test from 'node:test';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
import { buildClientApiLimitsGuide } from '../../client-api/bulk/limits.js';
import { buildMcpToolRegistry } from '../../mcp/registry.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('OpenAPI/MCP expose bulk-first operationIds', () => {
  const tools = buildMcpToolRegistry();
  const names = new Set(tools.map((tool) => tool.operationId));
  for (const name of [
    'getLimits',
    'previewBulkOperation',
    'createStagedLeadImport',
    'appendStagedLeadImportRows',
    'finalizeStagedLeadImport',
    'createBulkUploadUrl',
    'exportPeople',
    'enrollPeople',
    'updateLeadListMembership',
    'cancelBulkJob',
  ]) {
    assert.ok(names.has(name), `missing MCP tool ${name}`);
  }
  const limits = buildClientApiLimitsGuide();
  assert.equal(limits.file_ingress.local_path_not_supported, true);
  assert.ok(limits.max_queued_async_jobs_per_account > limits.max_async_jobs_per_account);
});

test('bulk-first staged import + list membership + enroll + cancel (API-only actions)', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('bulk-first'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: `${harness.namespace}-camp`,
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey('bulk-first');

    const limitsRes = await harness.request('/v1/meta/limits', { apiKey: apiKey.secret });
    assert.equal(limitsRes.status, 200);
    const limitsBody = await limitsRes.json() as { data: { file_ingress: { local_path_not_supported: boolean } } };
    assert.equal(limitsBody.data.file_ingress.local_path_not_supported, true);

    const staged = await harness.request(`/v1/campaigns/${graph.campaignId}/imports/staged`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {},
    });
    assert.equal(staged.status, 201);
    const stagedBody = await staged.json() as { data: { id: string } };
    const jobId = stagedBody.data.id;
    harness.trackedImportJobIds.add(jobId);

    const leads = Array.from({ length: 3 }, (_, i) => ({
      email: `${harness.namespace}-lead-${i}@example.com`,
      first_name: `Lead${i}`,
    }));
    const append = await harness.request(`/v1/jobs/${jobId}/staging-rows`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: { leads },
    });
    assert.equal(append.status, 200);
    const appendBody = await append.json() as { total_count: number };
    assert.equal(appendBody.total_count, 3);

    const finalized = await harness.request(`/v1/jobs/${jobId}/finalize`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {},
    });
    assert.equal(finalized.status, 202);
    await processImportJobById(jobId, { supabase: harness.supabase as never });

    const done = await harness.request(`/v1/jobs/${jobId}`, { apiKey: apiKey.secret });
    assert.equal(done.status, 200);
    const doneBody = await done.json() as { data: { status: string } };
    assert.equal(doneBody.data.status, 'completed');

    const listRes = await harness.request('/v1/lead-lists', {
      apiKey: apiKey.secret,
      method: 'POST',
      body: { name: `${harness.namespace}-list` },
    });
    assert.equal(listRes.status, 201);
    const listBody = await listRes.json() as { data: { id: string } };
    const listId = listBody.data.id;

    const preview = await harness.request('/v1/bulk/preview', {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {
        operation: 'add_to_lead_list',
        target_list_id: listId,
        scope: { kind: 'campaign', campaign_id: graph.campaignId },
      },
    });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { data: { preview_id: string } };
    assert.ok(previewBody.data.preview_id);

    const membership = await harness.request(`/v1/lead-lists/${listId}/members:bulk`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {
        operation: 'add_to_lead_list',
        scope: { kind: 'campaign', campaign_id: graph.campaignId },
        preview_id: previewBody.data.preview_id,
      },
    });
    assert.equal(membership.status, 202);
    const membershipBody = await membership.json() as { data: { id: string } };
    harness.trackedImportJobIds.add(membershipBody.data.id);
    await processImportJobById(membershipBody.data.id, { supabase: harness.supabase as never });

    const targetGraph = await harness.campaignHarness.createCampaignGraph({
      name: `${harness.namespace}-camp-b`,
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    const enroll = await harness.request(`/v1/campaigns/${targetGraph.campaignId}/enroll`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {
        scope: { kind: 'saved_list', list_id: listId },
        exclusions: { emails: [`${harness.namespace}-lead-0@example.com`] },
      },
    });
    assert.equal(enroll.status, 202);
    const enrollBody = await enroll.json() as { data: { id: string } };
    harness.trackedImportJobIds.add(enrollBody.data.id);
    await processImportJobById(enrollBody.data.id, { supabase: harness.supabase as never });

    const cancelTarget = await harness.request('/v1/jobs', {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {
        operation: 'add_to_campaign',
        campaign_id: targetGraph.campaignId,
        scope: { kind: 'saved_list', list_id: listId },
      },
    });
    assert.equal(cancelTarget.status, 202);
    const cancelBody = await cancelTarget.json() as { data: { id: string } };
    harness.trackedImportJobIds.add(cancelBody.data.id);
    const cancelled = await harness.request(`/v1/jobs/${cancelBody.data.id}/cancel`, {
      apiKey: apiKey.secret,
      method: 'POST',
      body: {},
    });
    assert.equal(cancelled.status, 200);
    const cancelledBody = await cancelled.json() as { data: { status: string; result?: { cancelled?: boolean } } };
    assert.ok(
      cancelledBody.data.status === 'cancelled'
      || cancelledBody.data.status === 'failed'
      || cancelledBody.data.result?.cancelled === true,
      `unexpected cancel status ${cancelledBody.data.status}`,
    );

    const detail = await harness.request(`/v1/campaigns/${graph.campaignId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as { data: { mailbox_ids: string[] } };
    assert.ok(Array.isArray(detailBody.data.mailbox_ids));
  } finally {
    await harness.cleanup();
  }
});
