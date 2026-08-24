import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_API_VERSION } from '../../client-api/openapi/constants.js';
import {
  buildCampaignQuickstartMarkdown,
  buildCampaignSetupMarkdown,
  buildHandlingRepliesMarkdown,
  buildLeadManagementMarkdown,
} from '../../client-api/openapi/buildingCampaigns.js';
import { buildChangelogMarkdown } from '../../client-api/openapi/changelog.js';
import {
  buildCampaignsConceptMarkdown,
  buildSequencesConceptMarkdown,
} from '../../client-api/openapi/concepts.js';
import { buildFaqMarkdown } from '../../client-api/openapi/faq.js';
import {
  buildAuthenticationMarkdown,
  buildClientApiIntroMarkdown,
  buildClientApiIntroMdx,
} from '../../client-api/openapi/intro.js';
import { buildLlmsFullTxt, buildLlmsTxt } from '../../client-api/openapi/llms.js';
import { buildMcpGuideMarkdown } from '../../client-api/openapi/mcp.js';
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
    paths: Record<string, Record<string, { operationId?: string; tags?: string[]; description?: string; responses?: Record<string, unknown>; requestBody?: unknown }>>;
  };

  assert.match(spec.info.description, /\/docs/);
  assert.ok(!('x-tagGroups' in spec));

  assert.ok(spec.tags.some((tag) => tag.name === 'Campaigns'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Flow'));
  assert.ok(spec.tags.some((tag) => tag.name === 'Inbox'));
  assert.ok(!spec.tags.some((tag) => tag.name === 'Building campaigns'));

  assert.ok('LeadCreate' in spec.components.schemas);
  const leadCreate = spec.components.schemas.LeadCreate as {
    properties?: Record<string, { type?: string; items?: { type?: string }; description?: string }>;
  };
  assert.equal(leadCreate.properties?.tags?.type, 'array');
  assert.equal(leadCreate.properties?.tags?.items?.type, 'string');
  assert.match(leadCreate.properties?.tags?.description ?? '', /Hunter\.io/);
  assert.ok(leadCreate.properties?.email_verification);
  assert.match(leadCreate.properties?.email_verification?.description ?? '', /millionverifier|verification/i);
  assert.ok('CampaignCreate' in spec.components.schemas);
  assert.ok('FlowUpdate' in spec.components.schemas);
  assert.ok('FlowValidateResponse' in spec.components.schemas);
  assert.ok('ApiError' in spec.components.schemas);
  assert.ok('ThreadUpdate' in spec.components.schemas);
  assert.ok('MessageJob' in spec.components.schemas);
  assert.ok('Message' in spec.components.schemas);
  const messageSchema = spec.components.schemas.Message as {
    properties?: Record<string, { type?: string; nullable?: boolean; items?: { type?: string } }>;
    additionalProperties?: boolean;
  };
  assert.equal(messageSchema.additionalProperties, false);
  assert.ok(messageSchema.properties?.to_name);
  assert.equal(messageSchema.properties?.to_name?.nullable, true);
  assert.ok(messageSchema.properties?.cc);
  assert.equal(messageSchema.properties?.cc?.type, 'array');
  assert.equal(messageSchema.properties?.cc?.nullable, true);
  assert.ok(messageSchema.properties?.to_emails);
  assert.equal(messageSchema.properties?.to_emails?.type, 'array');
  assert.equal(messageSchema.properties?.to_emails?.nullable, true);
  assert.ok('ForwardRequest' in spec.components.schemas);
  assert.ok('ReplaceLeadRequest' in spec.components.schemas);
  assert.ok('ReplaceLeadPreview' in spec.components.schemas);
  assert.ok('ReplaceLeadPreviewLead' in spec.components.schemas);
  assert.ok('ReplaceLeadPreviewResponse' in spec.components.schemas);
  assert.ok('ConflictError' in spec.components.responses);

  const campaignCreate = spec.components.schemas.CampaignCreate as {
    properties?: {
      schedule?: { description?: string };
      sending_interval_seconds?: { description?: string };
    };
  };
  assert.match(campaignCreate.properties?.schedule?.description ?? '', /Omit to use Central 9–5/);
  assert.match(campaignCreate.properties?.schedule?.description ?? '', /null.*24\/7/i);
  assert.match(
    campaignCreate.properties?.sending_interval_seconds?.description ?? '',
    /1440/,
  );

  const previewReplace = spec.paths['/v1/threads/{id}/replace-lead/preview']?.get;
  assert.ok(previewReplace);
  assert.equal(previewReplace?.operationId, 'previewThreadLeadReplacement');
  assert.deepEqual(previewReplace?.tags, ['Inbox']);

  const replaceLead = spec.paths['/v1/threads/{id}/replace-lead']?.post;
  assert.ok(replaceLead);
  assert.match(replaceLead?.description ?? '', /previewThreadLeadReplacement/);
  assert.ok(replaceLead?.responses?.['409']);

  const asyncImport = spec.paths['/v1/campaigns/{id}/leads/bulk/async']?.post;
  assert.ok(asyncImport);
  assert.deepEqual(asyncImport?.tags, ['Jobs']);

  const listLeadListPeople = spec.paths['/v1/lead-lists/{id}/people']?.get;
  assert.ok(listLeadListPeople);
  assert.deepEqual(listLeadListPeople?.tags, ['Lead lists']);
});

test('client api guide markdown includes webhook examples', () => {
  const introMdx = buildClientApiIntroMdx();
  assert.match(introMdx, /What you can build/);
  assert.match(introMdx, /CardGroup/);
  assert.doesNotMatch(introMdx, /@astrojs\/starlight/);
  assert.doesNotMatch(introMdx, /Scalar/);
  assert.match(buildClientApiIntroMarkdown(), /What you can build/);
  // Reference-heavy conventions must not leak into the Documentation intro.
  assert.doesNotMatch(buildClientApiIntroMarkdown(), /flow_locked/);
  assert.doesNotMatch(buildClientApiIntroMarkdown(), /Idempotency-Key/);

  const auth = buildAuthenticationMarkdown('docs');
  assert.match(auth, /Authorization: Bearer/);
  assert.match(auth, /Account Settings/);

  const changelog = buildChangelogMarkdown();
  assert.match(changelog, /Breaking changes increment the major version/);
  assert.match(changelog, /## 1\.12\.0/);
  assert.match(changelog, /## 1\.10\.0/);
  assert.match(changelog, /Central 9–5 Mon–Fri/);
  assert.match(changelog, /## 1\.4\.3/);
  assert.match(changelog, /Fumadocs \+ OpenAPI reference/);

  const quickstart = buildCampaignQuickstartMarkdown('docs');
  assert.match(quickstart, /first (successful )?request/i);
  assert.match(quickstart, /\/v1\/mailboxes/);
  assert.match(quickstart, /POST '?https:\/\/api\.getfurnace\.io\/v1\/campaigns/);
  // Quickstart stays minimal — no advanced/reference concepts.
  assert.doesNotMatch(quickstart, /field_sync/);
  assert.doesNotMatch(quickstart, /If-Match/);

  const campaignSetup = buildCampaignSetupMarkdown('docs');
  assert.match(campaignSetup, /Build and launch/i);
  assert.match(campaignSetup, /\/v1\/campaigns\/[0-9a-f-]+\/flow/);
  assert.match(campaignSetup, /\/v1\/campaigns\/[0-9a-f-]+\/launch/);
  assert.match(campaignSetup, /Editing after launch/i);
  // Plain-language: no DAG/normalization/change_reasons jargon.
  assert.doesNotMatch(campaignSetup, /flow_locked/);
  assert.doesNotMatch(campaignSetup, /change_reasons/);

  const leadManagement = buildLeadManagementMarkdown('docs');
  assert.match(leadManagement, /By the end of this guide/);
  assert.match(leadManagement, /Common mistakes/);
  assert.match(leadManagement, /custom_lead_data/);
  assert.match(leadManagement, /leads\/bulk/);
  assert.match(leadManagement, /leads:add/);
  assert.match(leadManagement, /Tags and email verification/);
  assert.match(leadManagement, /email_verification/);

  const handlingReplies = buildHandlingRepliesMarkdown('docs');
  assert.match(handlingReplies, /By the end of this guide/);
  assert.match(handlingReplies, /Common mistakes/);
  assert.match(handlingReplies, /\/v1\/threads/);
  assert.match(handlingReplies, /message-jobs/);

  const campaignsConcept = buildCampaignsConceptMarkdown('docs');
  assert.match(campaignsConcept, /[Dd]raft/);
  assert.doesNotMatch(campaignsConcept, /topology/i);

  const sequencesConcept = buildSequencesConceptMarkdown('docs');
  assert.match(sequencesConcept, /\{\{first_name\}\}/);
  assert.doesNotMatch(sequencesConcept, /directed acyclic graph/i);

  const faq = buildFaqMarkdown('docs');
  assert.match(faq, /API key/);

  const mcpGuide = buildMcpGuideMarkdown('docs');
  assert.match(mcpGuide, /tag by \*\*name\*\*/i);
  assert.match(mcpGuide, /email_verification/);

  const spec = buildClientApiOpenApiSpec('https://api.example.com') as {
    components: { schemas: Record<string, { description?: string }> };
  };

  // Schema descriptions (API Reference tab) must not link to deleted guide pages.
  const campaignFlow = spec.components.schemas.CampaignFlow?.description ?? '';
  assert.doesNotMatch(campaignFlow, /\/guides\/flow-schemas\//);

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
  assert.match(emailActivity, /"email": "lead@example.com"/);
  assert.match(emailActivity, /"body_text":/);
  assert.match(emailActivity, /"mailbox_email":/);
  assert.match(emailActivity, /"campaign_name":/);
});

test('client api llms exports include guides and version', () => {
  const llms = buildLlmsTxt('https://api.example.com');
  assert.match(llms, new RegExp(`v${CLIENT_API_VERSION.replace(/\./g, '\\.')}`));
  assert.match(llms, /\/docs\/guides\/quickstart\//);
  assert.match(llms, /\/docs\/concepts\/campaigns\//);
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
