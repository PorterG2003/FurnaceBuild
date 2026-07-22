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
      description: 'What the Furnace Client API is and where to start.',
    },
    {
      title: 'Quickstart',
      path: docsPath('/guides/quickstart/'),
      description: 'Get an API key and make your first request.',
    },
    {
      title: 'Authentication',
      path: docsPath('/guides/authentication/'),
      description: 'API keys, the Authorization header, and base URL.',
    },
    {
      title: 'Campaigns',
      path: docsPath('/concepts/campaigns/'),
      description: 'What a campaign is and how its lifecycle works.',
    },
    {
      title: 'Leads and people',
      path: docsPath('/concepts/leads-people/'),
      description: 'How people, leads, saved lists, and custom fields relate.',
    },
    {
      title: 'Mailboxes',
      path: docsPath('/concepts/mailboxes/'),
      description: 'The inboxes a campaign sends from and receives replies in.',
    },
    {
      title: 'Email sequences',
      path: docsPath('/concepts/sequences/'),
      description: 'Sequence steps and how to personalize emails.',
    },
    {
      title: 'Webhooks',
      path: docsPath('/concepts/webhooks/'),
      description: 'How Furnace notifies your systems when events happen.',
    },
    {
      title: 'Campaign setup',
      path: docsPath('/guides/campaign-setup/'),
      description: 'Build and launch a campaign end to end.',
    },
    {
      title: 'Lead management',
      path: docsPath('/guides/lead-management/'),
      description: 'Add, import, fix, and move people in a campaign.',
    },
    {
      title: 'Handling replies',
      path: docsPath('/guides/handling-replies/'),
      description: 'Find replies, send responses, and track message jobs.',
    },
    {
      title: 'Webhook integration',
      path: docsPath('/guides/webhook-integration/'),
      description: 'Set up a webhook URL, verify messages, and see example payloads.',
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

  guides.push(
    {
      title: 'FAQ',
      path: docsPath('/guides/faq/'),
      description: 'Quick answers to common questions.',
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
  );

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
    '## Campaign setup checklist',
    '1. GET /v1/mailboxes — pick a mailbox id to send from',
    '2. POST /v1/campaigns — create a draft',
    '3. POST /v1/campaigns/{id}/flow — add the email sequence',
    '4. POST /v1/campaigns/{id}/leads — add people',
    '5. POST /v1/campaigns/{id}/launch — start sending',
    '',
    '## Good to know',
    '- Campaigns move draft -> running -> paused/stopped',
    '- Running allows email copy and timing edits; pause to add/remove/reorder steps',
    '- Personalize with {{first_name}} and {{custom.company}} tokens',
    '- Read replies via /v1/threads; sending a reply returns a message job to poll',
    '- Use webhooks to be notified of sends, replies, and bounces',
    '- Full field-level detail lives in the API Reference (openapi.json)',
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
