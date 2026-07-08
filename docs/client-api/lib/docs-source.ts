import path from 'node:path';
import fs from 'node:fs';
import { loader, multiple, type Source } from 'fumadocs-core/source';
import { openapiPlugin, openapiSource } from 'fumadocs-openapi/server';
import type { Root, Node } from 'fumadocs-core/page-tree';
import { docs } from '../.source/server';
import { openapi } from './openapi';
import { getDocsSection, type DocsSection } from './docs-section';
import { getSchemaDescription } from './schema-operations';

export const DOCS_BASE_URL = '/docs';

function createSchemaVirtualSource(): Source<{ metaData: never; pageData: { title: string; description?: string; schemaName: string } }> {
  return {
    files: getSchemaNames().map((name) => ({
      type: 'page' as const,
      path: `reference/schemas/${name}`,
      data: {
        title: name,
        description: getSchemaDescription(name),
        schemaName: name,
      },
    })),
  };
}

const openapiSourceData = await openapiSource(openapi, {
  baseDir: 'reference',
  per: 'operation',
  groupBy: 'tag',
  name: { algorithm: 'v2' },
  meta: {
    folderStyle: 'folder',
  },
});
const schemaSourceData = createSchemaVirtualSource();

export const source = loader(
  multiple({
    docs: docs.toFumadocsSource(),
    openapi: openapiSourceData,
    schemas: schemaSourceData,
  }),
  {
    baseUrl: DOCS_BASE_URL,
    plugins: [openapiPlugin()],
  },
);

// The docs `meta.json` (regenerated on every export) does not — and cannot reliably —
// enumerate the OpenAPI-generated reference pages, so they never make it into the merged
// `source.pageTree`. Build the reference sidebar tree from a dedicated loader over just the
// OpenAPI + schema sources so it is independent of the docs meta and identical in dev/build.
const referenceSource = loader(
  multiple({
    openapi: openapiSourceData,
    schemas: schemaSourceData,
  }),
  {
    baseUrl: DOCS_BASE_URL,
    plugins: [openapiPlugin()],
  },
);

function filterTreeBySection(tree: Root, section: DocsSection): Root {
  const children = tree.children.filter((node) => {
    const urls = collectNodeUrls(node);
    if (urls.length === 0) return section === 'docs';
    return urls.some((url) => getDocsSection(url) === section);
  });

  return {
    ...tree,
    children: section === 'reference' ? normalizeReferenceTree(children) : children,
  };
}

function collectNodeUrls(node: Node): string[] {
  if (node.type === 'page') return [node.url];
  if (node.type === 'folder') {
    return node.children.flatMap((child) => collectNodeUrls(child));
  }
  return [];
}

function normalizeReferenceTree(nodes: Node[]): Node[] {
  // The OpenAPI content is nested under a single "API Reference" wrapper folder
  // (created because it lives under the `reference/` base dir). Promote the tag
  // groups to the top level so they render as flat sidebar sections.
  let working = nodes;
  if (working.length === 1 && working[0].type === 'folder') {
    working = working[0].children ?? [];
  }

  const output: Node[] = [];
  const schemaNodes: Node[] = [];

  for (const node of working) {
    if (node.type === 'page' && node.url.includes('/reference/schemas/')) {
      schemaNodes.push(node);
      continue;
    }
    if (node.type === 'folder' && node.name === 'Schemas') {
      schemaNodes.push(...(node.children ?? []));
      continue;
    }
    output.push(node);
  }

  if (schemaNodes.length > 0) {
    output.push({
      type: 'folder',
      name: 'Schemas',
      $id: 'schemas-folder',
      children: schemaNodes.sort((a, b) => {
        const aName = a.type === 'page' ? String(a.name) : '';
        const bName = b.type === 'page' ? String(b.name) : '';
        return aName.localeCompare(bName);
      }),
    });
  }

  return output;
}

export const docsTree = filterTreeBySection(source.pageTree, 'docs');
export const referenceTree: Root = {
  ...referenceSource.pageTree,
  children: normalizeReferenceTree(referenceSource.pageTree.children),
};

export function getTreeForSection(section: DocsSection): Root {
  return section === 'reference' ? referenceTree : docsTree;
}

export function getSchemaNames(): string[] {
  const specPath = path.join(process.cwd(), 'public', 'openapi.json');
  const raw = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
    components?: { schemas?: Record<string, unknown> };
  };
  return Object.keys(raw.components?.schemas ?? {}).sort();
}

export { getDocsSection };
