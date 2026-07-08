import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_API_VERSION } from '../../client-api/openapi/constants.js';
import {
  buildBuildingCampaignsMarkdown,
  buildCampaignQuickstartMarkdown,
} from '../../client-api/openapi/buildingCampaigns.js';
import { buildChangelogMarkdown } from '../../client-api/openapi/changelog.js';
import { buildClientApiIntroMarkdown, buildClientApiIntroMdx } from '../../client-api/openapi/intro.js';
import { buildLlmsFullTxt, buildLlmsTxt } from '../../client-api/openapi/llms.js';
import { buildClientApiOpenApiSpec } from '../../client-api/openapi/spec.js';
import {
  buildWebhookEventGroupMarkdown,
  buildWebhooksOverviewMarkdown,
} from '../../client-api/openapi/webhooks.js';
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
    'x-tagGroups'?: Array<{ name: string; tags: string[] }>;
    components: {
      schemas: Record<string, unknown>;
      parameters: Record<string, unknown>;
      responses: Record<string, unknown>;
    };
    paths: Record<string, Record<string, { operationId?: string; tags?: string[]; responses?: Record<string, unknown>; requestBody?: unknown }>>;
  };

  assert.match(spec.info.description, /\/docs/);
  assert.ok(!('x-tagGroups' in spec));

  assert.ok(spec.tags.some((tag) => tag.name === 'Campaigns'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Flow'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Inbox'));
  assert.ok(!spec.tags.some((tag) => tag.name === 'Building campaigns'));

  assert.ok('LeadCreate' in spec.components.schemas);
  assert.ok('CampaignCreate' in spec.components.schemas);
  assert.ok('FlowUpdate' in spec.components.schemas);
  assert.ok('FlowValidateResponse' in spec.components.schemas);
  assert.ok('ApiError' in spec.components.schemas);
  assert.ok('ThreadUpdate' in spec.components.schemas);
  assert.ok('MessageJob' in spec.components.schemas);
  assert.ok('ForwardRequest' in spec.components.schemas);
  assert.ok('ReplaceLeadRequest' in spec.components.schemas);

  const asyncImport = spec.paths['/v1/campaigns/{id}/leads/bulk/async']?.post;
  assert.ok(asyncImport);
  assert.deepEqual(asyncImport?.tags, ['Jobs']);

  const listLeadListPeople = spec.paths['/v1/lead-lists/{id}/people']?.get;
  assert.ok(listLeadListPeople);
  assert.deepEqual(listLeadListPeople?.tags, ['Lead lists']);
});

test('client api guide markdown includes webhook examples', () => {
  const introMdx = buildClientApiIntroMdx();
  assert.match(introMdx, /Authentication/);
  assert.match(introMdx, /CardGroup/);
  assert.doesNotMatch(introMdx, /@astrojs\/starlight/);
  assert.doesNotMatch(introMdx, /Scalar/);
  assert.match(buildClientApiIntroMarkdown(), /flow_locked/);

  const changelog = buildChangelogMarkdown();
  assert.match(changelog, /Breaking changes increment the major version/);
  assert.match(changelog, /## 1\.4\.3/);
  assert.match(changelog, /Fumadocs \+ OpenAPI reference/);

  const quickstart = buildCampaignQuickstartMarkdown('docs');
  assert.match(quickstart, /TL;DR — checklist/i);
  assert.match(quickstart, /POST \/v1\/campaigns\/\{id\}\/flow/);

  const buildingCampaigns = buildBuildingCampaignsMarkdown('docs');
  assert.match(buildingCampaigns, /field_sync/);
  assert.match(buildingCampaigns, /If-Match/);
  assert.match(buildingCampaigns, /Draft vs live lock/i);
  assert.match(buildingCampaigns, /\[CampaignFlow\]\(\/docs\/reference\/schemas\/CampaignFlow\/\)/);

  const spec = buildClientApiOpenApiSpec('https://api.example.com') as {
    components: { schemas: Record<string, { description?: string }> };
  };

  const campaignFlow = spec.components.schemas.CampaignFlow?.description ?? '';
  assert.match(campaignFlow, /Flow schemas guide/);

  const flowValidationIssue = spec.components.schemas.FlowValidationIssue?.description ?? '';
  assert.match(flowValidationIssue, /Flow schemas/);

  const webhooksOverview = buildWebhooksOverviewMarkdown('docs');
  assert.match(webhooksOverview, /Quick start/);
  assert.match(webhooksOverview, /Verifying signatures/);

  const emailActivity = buildWebhookEventGroupMarkdown('email_activity');
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

test('client api llms exports include guides and version', () => {
  const llms = buildLlmsTxt('https://api.example.com');
  assert.match(llms, /v1\.4\.3/);
  assert.match(llms, /\/docs\/guides\/campaign-quickstart\//);
  assert.match(llms, /openapi\.json/);

  const full = buildLlmsFullTxt([{ title: 'Intro', body: 'Hello docs' }]);
  assert.match(full, /Hello docs/);
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
      info: { title: string; description: string; version: string };
      components: { schemas: Record<string, unknown> };
      'x-tagGroups'?: Array<{ name: string; tags: string[] }>;
    };
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'Furnace Client API');
    assert.equal(spec.info.version, CLIENT_API_VERSION);
    assert.ok('/v1/campaigns' in spec.paths);
    assert.ok(!('/documentation/changelog' in spec.paths));
    assert.ok('/v1/campaigns/{id}/leads/bulk/async' in spec.paths);
    assert.ok('/v1/jobs' in spec.paths);
    assert.ok('/v1/people' in spec.paths);
    assert.ok('/v1/lead-lists' in spec.paths);
    assert.match(spec.info.description, /\/docs/);
    assert.ok('LeadCreate' in spec.components.schemas);
    assert.ok(spec.paths['/v1/campaigns/{id}/leads'].post?.requestBody);
    assert.ok(spec.paths['/v1/threads/{id}/reply'].post?.responses?.['202']);
    assert.ok(!spec['x-tagGroups']);

    const removedChangelog = await harness.request('/openapi/changelog.json');
    assert.equal(removedChangelog.status, 404);

    const removedWebhooks = await harness.request('/openapi/webhooks.json');
    assert.equal(removedWebhooks.status, 404);
  } finally {
    await harness.cleanup();
  }
});
