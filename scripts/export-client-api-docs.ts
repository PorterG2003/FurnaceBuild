#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCampaignQuickstartMarkdown,
  buildCampaignSetupMarkdown,
  buildHandlingRepliesMarkdown,
  buildLeadManagementMarkdown,
} from '../lib/client-api/openapi/buildingCampaigns.js';
import { buildChangelogMarkdown } from '../lib/client-api/openapi/changelog.js';
import {
  buildCampaignsConceptMarkdown,
  buildLeadsPeopleConceptMarkdown,
  buildMailboxesConceptMarkdown,
  buildSequencesConceptMarkdown,
  buildWebhooksConceptMarkdown,
} from '../lib/client-api/openapi/concepts.js';
import { buildFaqMarkdown } from '../lib/client-api/openapi/faq.js';
import { buildAuthenticationMarkdown, buildClientApiIntroMdx } from '../lib/client-api/openapi/intro.js';
import { buildMcpGuideMarkdown } from '../lib/client-api/openapi/mcp.js';
import { buildLlmsFullTxt, buildLlmsGuideEntries, buildLlmsTxt } from '../lib/client-api/openapi/llms.js';
import { buildClientApiOpenApiSpec } from '../lib/client-api/openapi/spec.js';
import {
  buildWebhookEventGroupMarkdown,
  buildWebhooksOverviewMarkdown,
  WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS,
} from '../lib/client-api/openapi/webhooks.js';
import { WEBHOOK_EVENT_GROUPS } from '../lib/client-api/webhooks/eventGroups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const docsRoot = path.join(root, 'docs', 'client-api');
const contentRoot = path.join(docsRoot, 'content', 'docs');
const publicRoot = path.join(docsRoot, 'public');

const DEFAULT_CLIENT_API_BASE_URL = 'https://api.getfurnace.io';

type ExportedPage = {
  title: string;
  description: string;
  relativePath: string;
  body: string;
  mirrorBody: string;
  mirrorPath: string;
};

function writeDoc(
  relativePath: string,
  frontmatter: Record<string, string>,
  body: string,
  mirrorBody?: string,
): ExportedPage {
  const filePath = path.join(contentRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  const contents = `---\n${fm}\n---\n\n${body.trim()}\n`;
  fs.writeFileSync(filePath, contents, 'utf8');

  const mirrorPath = relativePath.replace(/\.mdx$/, '.md');
  const mirror = (mirrorBody ?? body).trim();
  fs.mkdirSync(path.dirname(path.join(publicRoot, mirrorPath)), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, mirrorPath), `${mirror}\n`, 'utf8');

  return {
    title: frontmatter.title ?? relativePath,
    description: frontmatter.description ?? '',
    relativePath,
    body: body.trim(),
    mirrorBody: mirror,
    mirrorPath,
  };
}

function resolveClientApiBaseUrl(): string {
  const fromEnv = process.env.CLIENT_API_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return DEFAULT_CLIENT_API_BASE_URL;
}

function writeMetaJson(pages: string[]): void {
  const meta = {
    title: 'Client API',
    pages,
  };
  fs.writeFileSync(path.join(contentRoot, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function writeSearchManifest(entries: Array<{ title: string; url: string; description: string }>): void {
  fs.writeFileSync(
    path.join(publicRoot, 'search-manifest.json'),
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf8',
  );
}

function syncDocBrandAssets(): void {
  const appPublic = path.join(root, 'public');
  // Same brand assets as the main app (public/index.html favicon links + logo).
  const brandAssets: Array<[string, string]> = [
    ['Logo_Color.svg', 'logo.svg'],
    ['favicon.svg', 'favicon.svg'],
    ['favicon-96x96.png', 'favicon-96x96.png'],
    ['favicon.ico', 'favicon.ico'],
    ['apple-touch-icon.png', 'apple-touch-icon.png'],
  ];
  for (const [sourceName, destName] of brandAssets) {
    fs.copyFileSync(path.join(appPublic, sourceName), path.join(publicRoot, destName));
  }
}

/** Remove generated public mirrors so stale paths cannot linger between exports. */
function pruneGeneratedPublicArtifacts(): void {
  for (const dir of ['guides', 'concepts', 'webhooks', 'reference']) {
    fs.rmSync(path.join(publicRoot, dir), { recursive: true, force: true });
  }
  for (const file of [
    'openapi.json',
    'llms.txt',
    'llms-full.txt',
    'search-manifest.json',
    'index.md',
    'changelog.md',
  ]) {
    fs.rmSync(path.join(publicRoot, file), { force: true });
  }
}

function main() {
  syncDocBrandAssets();

  fs.rmSync(contentRoot, { recursive: true, force: true });
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  pruneGeneratedPublicArtifacts();

  const exported: ExportedPage[] = [];

  // --- Get Started ---
  exported.push(
    writeDoc('index.mdx', {
      title: 'Introduction',
      description: 'What the Furnace Client API is and where to start.',
    }, buildClientApiIntroMdx('docs'), buildClientApiIntroMdx('openapi')),
  );

  exported.push(
    writeDoc('guides/quickstart.mdx', {
      title: 'Quickstart',
      description: 'Get an API key and make your first request in minutes.',
    }, buildCampaignQuickstartMarkdown('docs'), buildCampaignQuickstartMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/authentication.mdx', {
      title: 'Authentication',
      description: 'API keys, the Authorization header, and base URL.',
    }, buildAuthenticationMarkdown('docs'), buildAuthenticationMarkdown('openapi')),
  );

  // --- Core Concepts ---
  exported.push(
    writeDoc('concepts/campaigns.mdx', {
      title: 'Campaigns',
      description: 'What a campaign is and how its lifecycle works.',
    }, buildCampaignsConceptMarkdown('docs'), buildCampaignsConceptMarkdown('openapi')),
  );

  exported.push(
    writeDoc('concepts/leads-people.mdx', {
      title: 'Leads and people',
      description: 'How people, leads, saved lists, and custom fields relate.',
    }, buildLeadsPeopleConceptMarkdown('docs'), buildLeadsPeopleConceptMarkdown('openapi')),
  );

  exported.push(
    writeDoc('concepts/mailboxes.mdx', {
      title: 'Mailboxes',
      description: 'The inboxes a campaign sends from and receives replies in.',
    }, buildMailboxesConceptMarkdown('docs'), buildMailboxesConceptMarkdown('openapi')),
  );

  exported.push(
    writeDoc('concepts/sequences.mdx', {
      title: 'Email sequences',
      description: 'Sequence steps and how to personalize emails.',
    }, buildSequencesConceptMarkdown('docs'), buildSequencesConceptMarkdown('openapi')),
  );

  exported.push(
    writeDoc('concepts/webhooks.mdx', {
      title: 'Webhooks',
      description: 'How Furnace notifies your systems when events happen.',
    }, buildWebhooksConceptMarkdown('docs'), buildWebhooksConceptMarkdown('openapi')),
  );

  // --- Guides ---
  exported.push(
    writeDoc('guides/campaign-setup.mdx', {
      title: 'Campaign setup',
      description: 'Build and launch a campaign end to end.',
    }, buildCampaignSetupMarkdown('docs'), buildCampaignSetupMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/lead-management.mdx', {
      title: 'Lead management',
      description: 'Add, import, fix, and move people in a campaign.',
    }, buildLeadManagementMarkdown('docs'), buildLeadManagementMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/handling-replies.mdx', {
      title: 'Handling replies',
      description: 'Find replies, send responses, and track message jobs.',
    }, buildHandlingRepliesMarkdown('docs'), buildHandlingRepliesMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/webhook-integration.mdx', {
      title: 'Webhook integration',
      description: 'Set up a webhook URL, verify messages, and see example payloads.',
    }, buildWebhooksOverviewMarkdown('docs'), buildWebhooksOverviewMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/mcp.mdx', {
      title: 'MCP',
      description: 'Connect Cursor, Claude, ChatGPT, and other MCP clients to Furnace.',
    }, buildMcpGuideMarkdown('docs'), buildMcpGuideMarkdown('openapi')),
  );

  // --- Webhook events (payload reference) ---
  const webhookSegments: string[] = [];
  for (const group of WEBHOOK_EVENT_GROUPS) {
    const segment = WEBHOOK_GUIDE_GROUP_PATH_SEGMENTS[group.id];
    if (!segment) {
      throw new Error(`Missing webhook guide segment for group: ${group.id}`);
    }
    webhookSegments.push(`webhooks/${segment}`);
    exported.push(
      writeDoc(`webhooks/${segment}.mdx`, {
        title: group.label,
        description: group.description,
      }, buildWebhookEventGroupMarkdown(group.id, 'docs'), buildWebhookEventGroupMarkdown(group.id, 'openapi')),
    );
  }

  const webhookPageIds = webhookSegments.map((segment) => segment.replace(/\.mdx$/, ''));

  // --- Help ---
  exported.push(
    writeDoc('guides/faq.mdx', {
      title: 'FAQ',
      description: 'Quick answers to common questions.',
    }, buildFaqMarkdown('docs'), buildFaqMarkdown('openapi')),
  );

  // Reference tab landing (lives in the API Reference section, not the docs sidebar).
  exported.push(
    writeDoc('reference/index.mdx', {
      title: 'API Reference',
      description: 'Browse REST endpoints and schemas generated from the OpenAPI specification.',
    }, [
      'Interactive API reference grouped by tag. Use the **API Reference** tab in the header.',
      '',
      '- [OpenAPI JSON](/docs/openapi.json) — machine-readable spec',
      '- Schema pages live under `/docs/reference/schemas/{Name}/`',
      '',
      'Start with [Campaigns](/docs/reference/campaigns/) or [Flow](/docs/reference/flow/) endpoints.',
    ].join('\n'), [
      'Interactive API reference grouped by tag.',
      '',
      '- OpenAPI JSON: /docs/openapi.json',
      '- Schema pages: /docs/reference/schemas/{Name}/',
    ].join('\n')),
  );

  exported.push(
    writeDoc('changelog.mdx', {
      title: 'Changelog',
      description: 'Client API version history.',
    }, buildChangelogMarkdown()),
  );

  writeMetaJson([
    'index',
    '---Get Started---',
    'guides/quickstart',
    'guides/authentication',
    '---Core Concepts---',
    'concepts/campaigns',
    'concepts/leads-people',
    'concepts/mailboxes',
    'concepts/sequences',
    'concepts/webhooks',
    '---Guides---',
    'guides/campaign-setup',
    'guides/lead-management',
    'guides/handling-replies',
    'guides/webhook-integration',
    'guides/mcp',
    '---Webhook events---',
    ...webhookPageIds,
    '---Help---',
    'guides/faq',
    'changelog',
  ]);

  const baseUrl = resolveClientApiBaseUrl();
  const searchEntries = buildLlmsGuideEntries().map((entry) => ({
    title: entry.title,
    url: entry.path,
    description: entry.description ?? '',
  }));

  const spec = buildClientApiOpenApiSpec(baseUrl) as {
    components: { schemas: Record<string, { description?: string }> };
    paths: Record<string, Record<string, { summary?: string; description?: string; operationId?: string; tags?: string[] }>>;
  };

  for (const schemaName of Object.keys(spec.components.schemas).sort()) {
    const schema = spec.components.schemas[schemaName];
    searchEntries.push({
      title: schemaName,
      url: `/docs/reference/schemas/${schemaName}/`,
      description: typeof schema.description === 'string'
        ? schema.description.split('\n')[0].slice(0, 160)
        : 'OpenAPI schema',
    });
  }

  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation?.operationId) continue;
      const tag = operation.tags?.[0] ?? 'API';
      searchEntries.push({
        title: operation.summary ?? operation.operationId,
        url: `/docs/reference/${tag.toLowerCase().replace(/\s+/g, '-')}/${operation.operationId}/`,
        description: operation.description?.split('\n')[0].slice(0, 160) ?? `${method.toUpperCase()} ${routePath}`,
      });
    }
  }

  fs.writeFileSync(
    path.join(publicRoot, 'openapi.json'),
    `${JSON.stringify(spec, null, 2)}\n`,
    'utf8',
  );

  const llmsTxt = buildLlmsTxt(baseUrl);
  fs.writeFileSync(path.join(publicRoot, 'llms.txt'), llmsTxt, 'utf8');
  fs.writeFileSync(path.join(publicRoot, 'llms-full.txt'), buildLlmsFullTxt(
    exported.map((page) => ({ title: page.title, body: page.mirrorBody })),
  ), 'utf8');

  writeSearchManifest(searchEntries);

  console.log('Exported Client API docs to docs/client-api/');
}

main();
