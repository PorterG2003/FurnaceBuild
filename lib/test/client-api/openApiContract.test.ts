import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_API_VERSION, DEFAULT_ALLOWED_WEBHOOK_EVENTS } from '../../client-api/openapi/constants.js';
import { buildClientApiOpenApiSpec } from '../../client-api/openapi/spec.js';
import {
  buildWebhookSamplePreview,
  WEBHOOK_DOC_SAMPLE_CONTEXT,
} from '../../client-api/webhooks/webhookTestSamples.js';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('client api openapi spec documents auth, schemas, and request contracts', () => {
  const spec = buildClientApiOpenApiSpec('https://api.example.com') as {
    info: { description: string };
    tags: Array<{ name: string; description: string }>;
    'x-tagGroups': Array<{ name: string; tags: string[] }>;
    components: {
      schemas: Record<string, unknown>;
      parameters: Record<string, unknown>;
      responses: Record<string, unknown>;
    };
    paths: Record<string, Record<string, { operationId?: string; tags?: string[]; responses?: Record<string, unknown>; requestBody?: unknown }>>;
  };

  assert.match(spec.info.description, /Authentication/);
  assert.match(spec.info.description, /X-RateLimit-Limit/);
  assert.match(spec.info.description, /Idempotency-Key/);
  assert.match(spec.info.description, /Smartlead campaigns are read-only/);
  assert.match(spec.info.description, /Guide → Building campaigns/);
  assert.match(spec.info.description, /Models → CampaignFlow/);
  assert.match(spec.info.description, /flow_locked/);
  assert.match(spec.info.description, /Guide → Changelog/);
  assert.match(spec.info.description, /Guide → Webhooks/);

  assert.ok(spec.tags.some((tag) => tag.name === 'Building campaigns'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Changelog'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Webhooks'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Campaigns'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Flow'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Inbox'));
  assert.match(spec.info.description, /Inbox message jobs/);

  const guideGroup = spec['x-tagGroups'].find((group) => group.name === 'Guide');
  const apiGroup = spec['x-tagGroups'].find((group) => group.name === 'API');
  assert.ok(guideGroup);
  assert.deepEqual(guideGroup?.tags, ['Building campaigns', 'Changelog', 'Webhooks']);
  assert.ok(apiGroup?.tags.includes('Campaigns'));
  assert.ok(apiGroup?.tags.includes('Flow'));
  assert.ok(apiGroup?.tags.includes('Meta'));

  assert.ok('LeadCreate' in spec.components.schemas);
  assert.ok('CampaignCreate' in spec.components.schemas);
  assert.ok('FlowUpdate' in spec.components.schemas);
  assert.ok('FlowValidateResponse' in spec.components.schemas);
  assert.ok('ThreadUpdate' in spec.components.schemas);
  assert.ok('MessageJob' in spec.components.schemas);
  assert.ok('ForwardRequest' in spec.components.schemas);
  assert.ok('ReplaceLeadRequest' in spec.components.schemas);
  assert.ok('ThreadTag' in spec.components.schemas);
  assert.ok('BatchCompletionWebhookPayload' in spec.components.schemas);
  assert.ok('ImportJobCreate' in spec.components.schemas);
  assert.ok('IdempotencyKey' in spec.components.parameters);
  assert.ok('UnauthorizedError' in spec.components.responses);

  const leadSchema = spec.components.schemas.Lead as { properties?: Record<string, unknown> };
  assert.ok(leadSchema.properties?.global_lead_id);

  assert.equal(
    (spec.components.schemas.Lead as { properties?: Record<string, unknown> }).properties?.global_lead_id !== undefined,
    true,
  );
  assert.equal(DEFAULT_ALLOWED_WEBHOOK_EVENTS.includes('enrollment.created' as never), false);
  assert.equal(DEFAULT_ALLOWED_WEBHOOK_EVENTS.includes('enrollment.updated' as never), false);
  assert.ok(DEFAULT_ALLOWED_WEBHOOK_EVENTS.includes('enrollment.pause_completed'));
  assert.ok(DEFAULT_ALLOWED_WEBHOOK_EVENTS.includes('lead.added_to_campaign.completed'));

  const expectedOperations: Record<string, string[]> = {
    '/documentation/building-campaigns': ['get'],
    '/documentation/changelog': ['get'],
    '/documentation/webhooks': ['get'],
    '/documentation/webhooks/lead-added-updated': ['get'],
    '/documentation/webhooks/lead-removed': ['get'],
    '/documentation/webhooks/enrollment-pause-resume': ['get'],
    '/documentation/webhooks/campaign-status': ['get'],
    '/documentation/webhooks/email-activity': ['get'],
    '/health': ['get'],
    '/openapi.json': ['get'],
    '/docs': ['get'],
    '/v1/campaigns': ['get', 'post'],
    '/v1/campaign-tags': ['get', 'post'],
    '/v1/campaign-tags/{id}': ['patch', 'delete'],
    '/v1/campaigns/{id}': ['get', 'patch', 'delete'],
    '/v1/campaigns/{id}/pause': ['post'],
    '/v1/campaigns/{id}/status': ['patch'],
    '/v1/campaigns/{id}/stop': ['post'],
    '/v1/campaigns/{id}/resume': ['post'],
    '/v1/campaigns/{id}/launch': ['post'],
    '/v1/campaigns/{id}/enrollments/pause': ['post'],
    '/v1/campaigns/{id}/enrollments/resume': ['post'],
    '/v1/campaigns/{id}/flow': ['get', 'put', 'post'],
    '/v1/campaigns/{id}/flow/nodes/{nodeId}': ['patch'],
    '/v1/flow-templates': ['get'],
    '/v1/campaigns/{id}/flow:validate': ['post'],
    '/v1/campaigns/{id}/lead-fields': ['get', 'post'],
    '/v1/campaigns/{id}/leads': ['get', 'post'],
    '/v1/campaigns/{id}/leads/{leadId}': ['get', 'patch', 'delete'],
    '/v1/campaigns/{id}/leads/bulk': ['post'],
    '/v1/campaigns/{id}/leads/bulk/async': ['post'],
    '/v1/campaigns/{id}/leads:add': ['post'],
    '/v1/campaigns/{id}/leads:remove': ['post'],
    '/v1/leads:remove-from-all-campaigns': ['post'],
    '/v1/jobs': ['post'],
    '/v1/jobs/{id}': ['get'],
    '/v1/people': ['get'],
    '/v1/people/{globalLeadId}': ['get', 'patch'],
    '/v1/lead-lists': ['get', 'post'],
    '/v1/lead-lists/{id}': ['get', 'patch', 'delete'],
    '/v1/lead-lists/{id}/people': ['get'],
    '/v1/lead-lists/{id}/members': ['post', 'delete'],
    '/v1/mailbox-tags': ['get', 'post'],
    '/v1/mailbox-tags/{id}': ['patch', 'delete'],
    '/v1/mailboxes': ['get'],
    '/v1/mailboxes/{id}': ['patch', 'get'],
    '/v1/threads': ['get'],
    '/v1/threads/{id}': ['get', 'patch'],
    '/v1/threads/{id}/messages': ['get'],
    '/v1/threads/{id}/reply': ['post'],
    '/v1/threads/{id}/forward': ['post'],
    '/v1/threads/{id}/out-of-office': ['put', 'delete'],
    '/v1/threads/{id}/replace-lead': ['post'],
    '/v1/threads/{id}/tags:add': ['post'],
    '/v1/threads/{id}/tags:remove': ['post'],
    '/v1/thread-tags': ['get'],
    '/v1/message-jobs/{id}': ['get'],
    '/v1/message-jobs/{id}/cancel': ['post'],
    '/v1/message-jobs/{id}/send-now': ['post'],
    '/v1/block-list': ['get', 'post'],
    '/v1/block-list/{id}': ['delete'],
    '/v1/campaigns/{id}/stats': ['get'],
  };

  for (const [path, methods] of Object.entries(expectedOperations)) {
    assert.ok(path in spec.paths, `missing path ${path}`);
    for (const method of methods) {
      const operation = spec.paths[path]?.[method];
      assert.ok(operation, `missing ${method.toUpperCase()} ${path}`);
      assert.ok(operation.operationId, `missing operationId for ${method.toUpperCase()} ${path}`);
      assert.ok(operation.tags?.length, `missing tags for ${method.toUpperCase()} ${path}`);
      assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `missing responses for ${method.toUpperCase()} ${path}`);

      const isMutating = method === 'post' || method === 'patch';
      const skipRequestBody =
        path.startsWith('/documentation/')
        || path === '/v1/campaigns/{id}/pause'
        || path === '/v1/campaigns/{id}/stop'
        || path === '/v1/campaigns/{id}/resume'
        || path === '/v1/campaigns/{id}/launch'
        || path === '/v1/message-jobs/{id}/cancel'
        || path === '/v1/message-jobs/{id}/send-now'
        || (path === '/v1/threads/{id}/out-of-office' && method === 'delete');
      if (isMutating && !skipRequestBody) {
        assert.ok(operation.requestBody, `missing requestBody for ${method.toUpperCase()} ${path}`);
      }
    }
  }
});

test('client api guide documentation pages include webhook examples', () => {
  const spec = buildClientApiOpenApiSpec('https://api.example.com') as {
    paths: Record<string, { get?: { description?: string } }>;
    components: { schemas: Record<string, { description?: string }> };
  };

  const changelog = spec.paths['/documentation/changelog']?.get?.description ?? '';
  assert.match(changelog, /Breaking changes increment the major version/);
  assert.match(changelog, /## 1\.2\.0/);
  assert.match(changelog, /## 1\.3\.0/);
  assert.match(changelog, /## 1\.4\.1/);
  assert.match(changelog, /## 1\.4\.0/);
  assert.match(changelog, /flow_data/);

  const buildingCampaigns = spec.paths['/documentation/building-campaigns']?.get?.description ?? '';
  assert.match(buildingCampaigns, /What is a campaign/i);
  assert.match(buildingCampaigns, /field_sync/);
  assert.match(buildingCampaigns, /If-Match/);
  assert.match(buildingCampaigns, /POST \/v1\/campaigns\/\{id\}\/flow/);
  assert.match(buildingCampaigns, /Draft vs live lock/i);
  assert.match(buildingCampaigns, /Example flow: email -> wait -> email/);
  assert.match(buildingCampaigns, /End-to-end walkthrough/);
  assert.match(buildingCampaigns, /flow_locked/);
  assert.match(buildingCampaigns, /node_added/);
  assert.match(buildingCampaigns, /Models → \[CampaignFlow\]/);
  assert.match(buildingCampaigns, /FlowValidationIssue/);

  const campaignFlow = spec.components.schemas.CampaignFlow?.description ?? '';
  assert.match(campaignFlow, /Merge variables/);
  assert.match(campaignFlow, /Validation rules/);

  const flowValidationIssue = spec.components.schemas.FlowValidationIssue?.description ?? '';
  assert.match(flowValidationIssue, /Error-code catalog/);
  assert.match(flowValidationIssue, /invalid_variant_id/);

  assert.ok(!('/documentation/campaign-flow-reference' in spec.paths));

  const nonChangelogSpec = JSON.stringify({
    paths: Object.fromEntries(
      Object.entries(spec.paths).filter(([path]) => path !== '/documentation/changelog'),
    ),
    components: spec.components,
  });
  assert.doesNotMatch(nonChangelogSpec, /campaign-flow-reference/);
  assert.doesNotMatch(nonChangelogSpec, /Campaign flow reference/);

  const webhooksOverview = spec.paths['/documentation/webhooks']?.get?.description ?? '';
  assert.match(webhooksOverview, /Quick start/);
  assert.match(webhooksOverview, /Verifying signatures/);

  const emailActivity = spec.paths['/documentation/webhooks/email-activity']?.get?.description ?? '';
  assert.match(emailActivity, /Documentation only — this path is not callable/);
  assert.match(emailActivity, /`email.sent`/);
  assert.match(emailActivity, /`reply.received`/);
  assert.match(emailActivity, /`reply.categorized`/);
  assert.match(emailActivity, /`bounce.detected`/);

  const liveEmailSentExample = buildWebhookSamplePreview(
    'email.sent',
    WEBHOOK_DOC_SAMPLE_CONTEXT,
    { includeTestFlag: false },
  );
  assert.ok(emailActivity.includes(liveEmailSentExample));
  assert.doesNotMatch(liveEmailSentExample, /"test": true/);
});

test('client api exposes a public openapi contract and health endpoint', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('contract'),
  });

  try {
    const health = await harness.request('/health');
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status: string; db: string };
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.db, 'ok');

    const openapi = await harness.request('/openapi.json');
    assert.equal(openapi.status, 200);
    const spec = await openapi.json() as {
      openapi: string;
      paths: Record<string, Record<string, { requestBody?: unknown; responses?: Record<string, unknown>; description?: string }>>;
      info: { title: string; description: string };
      components: { schemas: Record<string, unknown> };
      'x-tagGroups': Array<{ name: string; tags: string[] }>;
    };
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'Furnace Client API');
    assert.equal(spec.info.version, CLIENT_API_VERSION);
    assert.ok('/v1/campaigns' in spec.paths);
    assert.ok('/documentation/changelog' in spec.paths);
    assert.ok('/documentation/webhooks/email-activity' in spec.paths);
    assert.ok('/v1/campaigns/{id}/leads/bulk/async' in spec.paths);
    assert.ok('/v1/jobs' in spec.paths);
    assert.ok('/v1/people' in spec.paths);
    assert.ok('/v1/lead-lists' in spec.paths);
    assert.match(spec.info.description, /Rate Limits/);
    assert.ok('LeadCreate' in spec.components.schemas);
    assert.ok(spec.paths['/v1/campaigns/{id}/leads'].post?.requestBody);
    assert.ok(spec.paths['/v1/threads/{id}/reply'].post?.responses?.['202']);
    assert.ok(spec['x-tagGroups'].some((group) => group.name === 'Guide'));
    assert.match(
      spec.paths['/documentation/webhooks/email-activity']?.get?.description ?? '',
      /"type": "email.sent"/,
    );

    const removedChangelog = await harness.request('/openapi/changelog.json');
    assert.equal(removedChangelog.status, 404);

    const removedWebhooks = await harness.request('/openapi/webhooks.json');
    assert.equal(removedWebhooks.status, 404);
  } finally {
    await harness.cleanup();
  }
});
