import { CLIENT_API_VERSION } from './constants.js';
import { docsPath } from './docLinks.js';
import { buildClientApiOpenApiSpec } from './spec.js';
import { WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS } from './webhooks.js';
import { WEBHOOK_EVENT_GROUPS } from '../webhooks/eventGroups.js';

export type LlmsGuideEntry = {
  title: string;
  path: string;
  description?: string;
};

export function buildLlmsGuideEntries(): LlmsGuideEntry[] {
  const guides: LlmsGuideEntry[] = [
    {
      title: 'Introduction',
      path: docsPath('/'),
      description: 'Authentication, rate limits, and core conventions.',
    },
    {
      title: 'Campaign quickstart',
      path: docsPath('/guides/campaign-quickstart/'),
      description: 'Checklist and lifecycle overview for new integrations.',
    },
    {
      title: 'Campaign flow',
      path: docsPath('/guides/campaign-flow/'),
      description: 'Save flow, field_sync, If-Match, and validation dry-runs.',
    },
    {
      title: 'Campaign launch',
      path: docsPath('/guides/campaign-launch/'),
      description: 'Launch, status changes, and draft vs live locking.',
    },
    {
      title: 'Flow schemas',
      path: docsPath('/guides/flow-schemas/'),
      description: 'CampaignFlow node types, merge variables, normalization, and validation codes.',
    },
    {
      title: 'Webhooks',
      path: docsPath('/webhooks/'),
      description: 'Outbound webhook setup, verification, and payloads.',
    },
    {
      title: 'Changelog',
      path: docsPath('/changelog/'),
      description: 'Client API version history.',
    },
    {
      title: 'API Reference',
      path: docsPath('/reference/'),
      description: 'OpenAPI reference grouped by tag (read-only, Furnace-branded).',
    },
  ];

  for (const group of WEBHOOK_EVENT_GROUPS) {
    const segment = WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS[group.id];
    if (!segment) continue;
    guides.push({
      title: group.label,
      path: docsPath(`/webhooks/${segment}/`),
      description: group.description,
    });
  }

  return guides;
}

export function buildLlmsTxt(baseUrl = 'https://api.getfurnace.io'): string {
  const spec = buildClientApiOpenApiSpec(baseUrl.replace(/\/$/, ''));
  const guides = buildLlmsGuideEntries();

  const lines = [
    `# Furnace Client API — LLM index (v${CLIENT_API_VERSION})`,
    '',
    '## Docs site',
    ...guides.map((guide) => `- ${guide.title}: ${guide.path}`),
    '',
    '## Machine-readable API',
    `- OpenAPI: ${baseUrl.replace(/\/$/, '')}/openapi.json`,
    `- Full docs corpus: ${baseUrl.replace(/\/$/, '')}/llms-full.txt`,
    '',
    '## OpenAPI tags',
    ...spec.tags.map((tag) => `- ${tag.name}: ${tag.description}`),
    '',
    '## Flow object (API Reference)',
    `- CampaignFlow — ${docsPath('/reference/schemas/CampaignFlow/')}`,
    `- FlowUpdate — ${docsPath('/reference/schemas/FlowUpdate/')}`,
    `- FlowValidationIssue — ${docsPath('/reference/schemas/FlowValidationIssue/')}`,
    '',
    '## Campaign checklist',
    '1. GET /v1/mailboxes',
    '2. POST /v1/campaigns',
    '3. POST /v1/campaigns/{id}/flow (+ optional If-Match)',
    '4. POST /v1/campaigns/{id}/leads',
    '5. GET /v1/campaigns/{id}?include=launch_state,lead_field_state',
    '6. POST /v1/campaigns/{id}/launch',
    '',
    '## Key v1.4 behaviors',
    '- POST /flow is the hero save; PUT /flow is a deprecated alias',
    '- flow_revision + If-Match prevent lost updates (412 flow_revision_conflict)',
    '- field_sync auto-declares merge-variable fields from copy',
    '- PATCH /status for live pause/resume/stop; POST /launch is draft-only',
    '- GET /v1/campaigns list omits flow_data — use GET /v1/campaigns/{id} for full flow',
    '- GET /v1/flow-templates for starter graphs',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

export function buildLlmsFullTxt(sections: Array<{ title: string; body: string }>): string {
  const parts = [
    `# Furnace Client API — full docs corpus (v${CLIENT_API_VERSION})`,
    '',
    'Plain markdown export for agents. HTML docs live under /docs/.',
    '',
  ];

  for (const section of sections) {
    parts.push(`---`, '', `# ${section.title}`, '', section.body.trim(), '', '');
  }

  return `${parts.join('\n')}\n`;
}
