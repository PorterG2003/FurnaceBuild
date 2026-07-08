#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCampaignFlowMarkdown,
  buildCampaignLaunchMarkdown,
  buildCampaignQuickstartMarkdown,
  buildFlowSchemasMarkdown,
} from '../lib/client-api/openapi/buildingCampaigns.js';
import { buildChangelogMarkdown } from '../lib/client-api/openapi/changelog.js';
import { buildClientApiIntroMdx } from '../lib/client-api/openapi/intro.js';
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
  const logoSource = path.join(root, 'public', 'Logo_Color.svg');
  fs.copyFileSync(logoSource, path.join(publicRoot, 'logo.svg'));
}

function main() {
  syncDocBrandAssets();

  fs.rmSync(contentRoot, { recursive: true, force: true });
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });

  const exported: ExportedPage[] = [];

  exported.push(
    writeDoc('index.mdx', {
      title: 'Introduction',
      description: 'Furnace Client API authentication, rate limits, and core conventions.',
    }, buildClientApiIntroMdx('docs'), buildClientApiIntroMdx('openapi')),
  );

  exported.push(
    writeDoc('guides/campaign-quickstart.mdx', {
      title: 'Campaign quickstart',
      description: 'Checklist and lifecycle overview for building campaigns through the Client API.',
    }, buildCampaignQuickstartMarkdown('docs'), buildCampaignQuickstartMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/campaign-flow.mdx', {
      title: 'Campaign flow',
      description: 'Save flow graphs, field_sync, If-Match concurrency, and validation dry-runs.',
    }, buildCampaignFlowMarkdown('docs'), buildCampaignFlowMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/campaign-launch.mdx', {
      title: 'Campaign launch',
      description: 'Launch campaigns, manage live status, and recover from flow validation errors.',
    }, buildCampaignLaunchMarkdown('docs'), buildCampaignLaunchMarkdown('openapi')),
  );

  exported.push(
    writeDoc('guides/flow-schemas.mdx', {
      title: 'Flow schemas',
      description: 'CampaignFlow node types, merge variables, normalization rules, and validation codes.',
    }, buildFlowSchemasMarkdown('docs'), buildFlowSchemasMarkdown('openapi')),
  );

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

  exported.push(
    writeDoc('webhooks/index.mdx', {
      title: 'Webhooks',
      description: 'Outbound webhook setup, verification, and example payloads.',
    }, buildWebhooksOverviewMarkdown('docs'), buildWebhooksOverviewMarkdown('openapi')),
  );

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
      }, buildWebhookEventGroupMarkdown(group.id)),
    );
  }

  const webhookPageIds = webhookSegments.map((segment) => segment.replace(/\.mdx$/, ''));

  writeMetaJson([
    'index',
    '---Getting started---',
    'guides/campaign-quickstart',
    'guides/campaign-flow',
    'guides/campaign-launch',
    'guides/flow-schemas',
    '---Guides---',
    'webhooks/index',
    ...webhookPageIds.filter((id) => id !== 'webhooks/index'),
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
